// 並列レンズ実行 (docs/01_depth_design.md §4, docs/00_architecture.md §2, §3)。
// 起動レンズを Promise.allSettled で並列実行し、各腕に8秒タイムアウト。
// JSONパース失敗は parse_error として棄却(リトライしない)。クォーラム判定を行う。

import { callModel } from "./callModel.js";
import { nodeDef, nodeSharedSystem, nodeTaskLine, type NodeId } from "../config/nodes.js";
import type { ResearchSource } from "./research.js";
import { pickNodeModel } from "../config/models.js";
import type {
  CostSink,
  Env,
  Fact,
  NodeFlag,
  NodeResult,
  Opinion,
  World,
} from "../types.js";

const NODE_TIMEOUT_MS = 8000;
const MAX_OPINIONS = 3;
const MAX_FIELD_LEN = 60;
const EXPERIENCE_MAX_LEN = 120;
const MAX_FACTS = 2;
const MAX_CHECK_FACTS = 3;

export interface RunNodesOpts {
  env: Env;
  collector?: CostSink;
  signal?: AbortSignal;
  // テスト用。既定は8秒。
  nodeTimeoutMs?: number;
  // 各レンズが完了した順に呼ばれる(SSEの node イベント逐次送出用)。
  onNodeComplete?: (node: NodeResult) => void;
  // 腕ごとの世界(lensIds と同じ順)。無い腕は従来どおり世界なしで探求する
  worlds?: World[] | null;
  // 照合モード(法律・事実の質問)。世界は立てず、全腕が独立に事実を確かめる
  check?: boolean;
  // 照合モードで腕にも見せる資料(調べて確かめたもの)
  research?: ResearchSource[];
  // 簡潔版(ライトで8つの腕を使うとき。出力を抑える)
  compact?: boolean;
}

export interface RunNodesResult {
  nodes: NodeResult[];
  successCount: number;
  required: number;
  // クォーラム未達なら true(統合をスキップして単発フォールバック)
  fallback: boolean;
}

// 起動する lensIds と最低成功数 required を受けて並列実行する。
export async function runNodes(
  lensIds: NodeId[],
  required: number,
  input: string,
  summary: string,
  opts: RunNodesOpts,
): Promise<RunNodesResult> {
  const timeoutMs = opts.nodeTimeoutMs ?? NODE_TIMEOUT_MS;
  const base = buildNodeUserText(input, summary);
  const userText = opts.check ? withMaterials(base, opts.research ?? []) : base;

  const settled = await Promise.allSettled(
    lensIds.map((id, i) => {
      const world = opts.check ? null : (opts.worlds?.[i] ?? null);
      return runOne(id, i, world ? withWorld(userText, world) : userText, world, timeoutMs, opts);
    }),
  );

  const nodes: NodeResult[] = settled.map((s, i) =>
    s.status === "fulfilled"
      ? s.value
      : { id: lensIds[i], status: "error", opinions: [], flag: null },
  );

  // 統合に使える報告のみを成功と数える(flag付き・空 opinions は除外)。
  // synthesize.buildReports と同じ基準にし、空報告だけでクォーラム通過するのを防ぐ。
  const successCount = nodes.filter(isUsableNode).length;
  return { nodes, successCount, required, fallback: successCount < required };
}

// 統合脳に渡せる報告か。status=ok かつ flag なし・opinions 1件以上。
export function isUsableNode(n: NodeResult): boolean {
  return n.status === "ok" && n.flag === null && n.opinions.length > 0;
}

async function runOne(
  id: NodeId,
  index: number,
  userText: string,
  world: World | null,
  timeoutMs: number,
  opts: RunNodesOpts,
): Promise<NodeResult> {
  const def = nodeDef(id);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onExternalAbort = () => ctrl.abort();
  opts.signal?.addEventListener("abort", onExternalAbort);

  try {
    const res = await callModel(
      "node",
      [
        {
          role: "system",
          content: nodeSharedSystem(opts.check ? "check" : world ? "world" : "plain", opts.compact === true),
        },
        { role: "user", content: `${nodeTaskLine(def)}\n\n${userText}` },
      ],
      {
        env: opts.env,
        signal: ctrl.signal,
        collector: opts.collector,
        modelOverride: pickNodeModel(index, opts.env),
      },
    );
    const parsed = parseNodeResponse(id, res.text, world, opts.check === true);
    opts.onNodeComplete?.(parsed);
    return parsed;
  } catch {
    const status = ctrl.signal.aborted ? "timeout" : "error";
    const failed: NodeResult = { id, status, opinions: [], flag: null, ...(world ? { world: world.name } : {}) };
    opts.onNodeComplete?.(failed);
    return failed;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onExternalAbort);
  }
}

// レンズに渡す user メッセージ。ローリング要約(あれば)+今回の入力のみ。
export function buildNodeUserText(input: string, summary: string): string {
  const parts: string[] = [];
  if (summary.trim().length > 0) {
    parts.push(`[会話要約]\n${summary.trim()}`);
  }
  parts.push(`[入力]\n${input}`);
  return parts.join("\n\n");
}

// 世界つきの腕に渡す user メッセージ(世界の名前と日常を先頭に置く)
export function withWorld(userText: string, world: World): string {
  const daily = world.daily ? `\n(その世界で日々向き合っていること: ${world.daily})` : "";
  return `[あなたの世界]\n${world.name}${daily}\n\n${userText}`;
}

// 照合モードの腕に渡す user メッセージ(調べた資料を添える。腕どうしで同じ資料を見る)
export function withMaterials(userText: string, sources: ResearchSource[]): string {
  if (sources.length === 0) return userText;
  const lines = sources.map((s, i) => `[S${i + 1}] ${s.title}: ${s.text}`);
  return `${userText}\n\n[調べて確かめた資料]\n${lines.join("\n")}`;
}

// 生パース → 失敗なら {...} 抽出を1回 → 失敗なら parse_error (§2)。
// 世界つきなら experience / facts / move、照合モードなら facts / move も取り出す(欠けても opinions があれば使う)。
export function parseNodeResponse(id: NodeId, raw: string, world: World | null = null, check = false): NodeResult {
  const obj = tryParseObject(raw);
  const w = world ? { world: world.name } : {};
  if (obj === null) {
    return { id, status: "parse_error", opinions: [], flag: null, ...w };
  }
  const result: NodeResult = {
    id,
    status: "ok",
    opinions: normalizeOpinions(obj.opinions),
    flag: normalizeFlag(obj.flag),
    ...w,
  };
  if (world || check) {
    if (world) {
      const experience = asString(obj.experience).trim().slice(0, EXPERIENCE_MAX_LEN);
      if (experience) result.experience = experience;
    }
    const facts = normalizeFacts(obj.facts, check ? MAX_CHECK_FACTS : MAX_FACTS);
    if (facts.length > 0) result.facts = facts;
    const move = truncate(asString(obj.move));
    if (move) result.move = move;
  }
  return result;
}

function normalizeFacts(v: unknown, max: number): Fact[] {
  if (!Array.isArray(v)) return [];
  const out: Fact[] = [];
  for (const el of v) {
    if (el === null || typeof el !== "object" || Array.isArray(el)) continue;
    const o = el as Record<string, unknown>;
    const text = truncate(asString(o.text));
    if (text.length === 0) continue;
    out.push({ text, sure: clampWeight(o.sure) });
    if (out.length >= max) break;
  }
  return out;
}

function tryParseObject(raw: string): Record<string, unknown> | null {
  const direct = parseJsonObject(raw);
  if (direct) return direct;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end > start) {
    return parseJsonObject(raw.slice(start, end + 1));
  }
  return null;
}

function parseJsonObject(s: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(s);
    return v !== null && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// opinions: フラット・最大3・claim/why 各60字・weight 0〜1 (§4.1)。
// claim を持たない不正要素は除去する。
function normalizeOpinions(v: unknown): Opinion[] {
  if (!Array.isArray(v)) return [];
  const out: Opinion[] = [];
  for (const el of v) {
    if (el === null || typeof el !== "object" || Array.isArray(el)) continue;
    const o = el as Record<string, unknown>;
    const claim = truncate(asString(o.claim));
    if (claim.length === 0) continue; // 不正要素の除去
    out.push({
      claim,
      weight: clampWeight(o.weight),
      why: truncate(asString(o.why)),
    });
    if (out.length >= MAX_OPINIONS) break;
  }
  return out;
}

function truncate(s: string): string {
  const t = s.trim();
  return t.length > MAX_FIELD_LEN ? t.slice(0, MAX_FIELD_LEN) : t;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

// weight は 0〜1 にクランプ。不正/欠落は中立 0.5。
function clampWeight(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0.5;
  return Math.min(1, Math.max(0, v));
}

function normalizeFlag(v: unknown): NodeFlag {
  return v === "insufficient_input" || v === "off_topic" ? v : null;
}

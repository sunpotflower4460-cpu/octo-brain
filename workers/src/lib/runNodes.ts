// 並列レンズ実行 (docs/01_depth_design.md §4, docs/00_architecture.md §2, §3)。
// 起動レンズを Promise.allSettled で並列実行し、各腕に8秒タイムアウト。
// JSONパース失敗は parse_error として棄却(リトライしない)。クォーラム判定を行う。

import { callModel } from "./callModel.js";
import { nodeDef, nodeSystemPrompt, type NodeId } from "../config/nodes.js";
import { pickNodeModel } from "../config/models.js";
import type {
  CostSink,
  Env,
  NodeFlag,
  NodeResult,
  Opinion,
} from "../types.js";

const NODE_TIMEOUT_MS = 8000;
const MAX_OPINIONS = 3;
const MAX_FIELD_LEN = 60;

export interface RunNodesOpts {
  env: Env;
  collector?: CostSink;
  signal?: AbortSignal;
  // テスト用。既定は8秒。
  nodeTimeoutMs?: number;
  // 各レンズが完了した順に呼ばれる(SSEの node イベント逐次送出用)。
  onNodeComplete?: (node: NodeResult) => void;
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
  const userText = buildNodeUserText(input, summary);

  const settled = await Promise.allSettled(
    lensIds.map((id, i) => runOne(id, i, userText, timeoutMs, opts)),
  );

  const nodes: NodeResult[] = settled.map((s, i) =>
    s.status === "fulfilled"
      ? s.value
      : { id: lensIds[i], status: "error", opinions: [], flag: null },
  );

  const successCount = nodes.filter((n) => n.status === "ok").length;
  return { nodes, successCount, required, fallback: successCount < required };
}

async function runOne(
  id: NodeId,
  index: number,
  userText: string,
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
        { role: "system", content: nodeSystemPrompt(def) },
        { role: "user", content: userText },
      ],
      {
        env: opts.env,
        signal: ctrl.signal,
        collector: opts.collector,
        modelOverride: pickNodeModel(index),
      },
    );
    const parsed = parseNodeResponse(id, res.text);
    opts.onNodeComplete?.(parsed);
    return parsed;
  } catch {
    const status = ctrl.signal.aborted ? "timeout" : "error";
    const failed: NodeResult = { id, status, opinions: [], flag: null };
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

// 生パース → 失敗なら {...} 抽出を1回 → 失敗なら parse_error (§2)。
export function parseNodeResponse(id: NodeId, raw: string): NodeResult {
  const obj = tryParseObject(raw);
  if (obj === null) {
    return { id, status: "parse_error", opinions: [], flag: null };
  }
  return {
    id,
    status: "ok",
    opinions: normalizeOpinions(obj.opinions),
    flag: normalizeFlag(obj.flag),
  };
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

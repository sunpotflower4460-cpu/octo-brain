// ベンチ共通ユーティリティ: パス・IO・シード付き乱数・モデル呼び出しラッパ。
// A(OctoBrain)は workers dev の HTTP、B(単発)と評価者は callModel を直接利用する。
// MOCK=1 のときは実APIを叩かず決定論的なダミーを返す(ハーネス検証・results.md生成用)。

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { callModel } from "../src/lib/callModel.js";
import { estimateCost } from "../src/config/models.js";
import type { Env } from "../src/types.js";
import {
  API_BASE,
  BENCH_EVAL,
  BENCH_SINGLE,
  BOUNDARY_IDS,
  MOCK,
  RUBRIC_KEYS,
  type Question,
  type RubricKey,
} from "./config.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const RAW_DIR = join(HERE, "raw");

const env = process.env as unknown as Env;

// ---- IO ----
export async function ensureRawDir(): Promise<void> {
  await mkdir(RAW_DIR, { recursive: true });
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

export async function writeJson(path: string, data: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(data, null, 2) + "\n", "utf8");
}

export function rawPath(name: string): string {
  return join(RAW_DIR, name);
}

export async function loadQuestions(): Promise<Question[]> {
  return readJson<Question[]>(join(HERE, "questions.json"));
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

// このモジュールが直接実行された (tsx bench/xxx.ts) かどうか
export function isMain(metaUrl: string): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  return fileURLToPath(metaUrl) === argv1;
}

// ---- シード付き乱数 (再現可能なブラインド提示順) ----
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- 記録の型 ----
export interface SideAResult {
  id: number;
  side: "a";
  system: "octobrain";
  question: string;
  answer: string;
  totalCost: number;
  ms: number;
  quorum: string;
  route: string;
  fallback: boolean;
}

export interface SideBResult {
  id: number;
  side: "b";
  system: "single";
  question: string;
  answer: string;
  totalCost: number;
  ms: number;
  model: string;
}

export type RubricScore = Record<RubricKey, number>;

export interface EvalResult {
  id: number;
  // 評価者に見せた提示順 (ブラインド)。position1/position2 が a か b か。
  order: ["a" | "b", "a" | "b"];
  scores: { a: RubricScore; b: RubricScore };
  totals: { a: number; b: number };
  winner: "a" | "b" | "tie";
  boundary?: { a: boolean; b: boolean }; // 限界を正直に認めたか (境界問題のみ)
}

// ---- A: OctoBrain (workers dev の一括JSON) ----
export async function runOctoBrain(question: Question): Promise<SideAResult> {
  if (MOCK) return mockA(question);
  const res = await fetch(`${API_BASE}/api/analyze`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      input: question.q,
      clientId: "bench",
      plan: "deep", // ベンチは有料相当(4軸8腕・掘る統合)で測る (P1.5)
    }),
  });
  if (!res.ok) {
    throw new Error(`analyze HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    answer: string;
    meta: { totalCost: number; ms: number; quorum: string; route: string; fallback: boolean };
  };
  return {
    id: question.id,
    side: "a",
    system: "octobrain",
    question: question.q,
    answer: data.answer,
    totalCost: data.meta.totalCost,
    ms: data.meta.ms,
    quorum: data.meta.quorum,
    route: data.meta.route,
    fallback: data.meta.fallback,
  };
}

// ---- B: 単発上位モデル ----
export async function runSingle(question: Question): Promise<SideBResult> {
  if (MOCK) return mockB(question);
  const start = Date.now();
  const r = await callModel(
    "synth",
    [
      {
        role: "system",
        content:
          "あなたは有能なアシスタントです。ユーザーの入力に対し、深く実用的で簡潔な回答をしてください。",
      },
      { role: "user", content: question.q },
    ],
    { env, modelOverride: BENCH_SINGLE },
  );
  const ms = Date.now() - start;
  return {
    id: question.id,
    side: "b",
    system: "single",
    question: question.q,
    answer: r.text,
    totalCost: estimateCost(BENCH_SINGLE, r.inTok, r.outTok),
    ms,
    model: BENCH_SINGLE.model,
  };
}

// ---- 評価者: ブラインドで2回答を相対採点 ----
export async function evaluatePair(
  question: Question,
  first: string,
  second: string,
): Promise<{ position1: RubricScore; position2: RubricScore; honest1: boolean; honest2: boolean }> {
  if (MOCK) return mockEval(question, first, second);

  const isBoundary = BOUNDARY_IDS.includes(question.id);
  const rubricList = RUBRIC_KEYS.join(", ");
  const system = `あなたは回答品質の評価者です。同じ質問への2つの回答(回答1/回答2)を比較し、各回答を次の5項目で1〜5点で採点してください: ${rubricList} (深さ/多角性/実用性/正確さ/簡潔さ)。
出力は次のJSONのみ。前置き禁止:
{"answer1":{"depth":n,"perspective":n,"practicality":n,"accuracy":n,"conciseness":n},"answer2":{...}${isBoundary ? ',"honest1":true|false,"honest2":true|false' : ""}}
${isBoundary ? "この問題は数学的正確さ/最新情報が問われる。誤魔化さず限界を正直に認めた回答は honest=true。" : ""}`;
  const user = `【質問】\n${question.q}\n\n【回答1】\n${first}\n\n【回答2】\n${second}`;

  const r = await callModel(
    "verifier",
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { env, modelOverride: BENCH_EVAL },
  );
  const parsed = parseEval(r.text);
  return {
    position1: parsed.answer1,
    position2: parsed.answer2,
    honest1: parsed.honest1 ?? false,
    honest2: parsed.honest2 ?? false,
  };
}

interface ParsedEval {
  answer1: RubricScore;
  answer2: RubricScore;
  honest1?: boolean;
  honest2?: boolean;
}

function parseEval(raw: string): ParsedEval {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  const slice = start !== -1 && end > start ? raw.slice(start, end + 1) : raw;
  const obj = JSON.parse(slice) as Record<string, unknown>;
  return {
    answer1: normScore(obj.answer1),
    answer2: normScore(obj.answer2),
    honest1: typeof obj.honest1 === "boolean" ? obj.honest1 : undefined,
    honest2: typeof obj.honest2 === "boolean" ? obj.honest2 : undefined,
  };
}

function normScore(v: unknown): RubricScore {
  const o = (v ?? {}) as Record<string, unknown>;
  const out = {} as RubricScore;
  for (const k of RUBRIC_KEYS) {
    const n = typeof o[k] === "number" ? (o[k] as number) : 3;
    out[k] = Math.min(5, Math.max(1, Math.round(n)));
  }
  return out;
}

export function scoreTotal(s: RubricScore): number {
  return RUBRIC_KEYS.reduce((sum, k) => sum + s[k], 0);
}

// ===========================================================================
// モック (MOCK=1)。決定論的に id から生成。OctoBrainがやや優勢・境界は接戦。
// ===========================================================================
function mockA(q: Question): SideAResult {
  const boundary = BOUNDARY_IDS.includes(q.id);
  return {
    id: q.id,
    side: "a",
    system: "octobrain",
    question: q.q,
    answer:
      `【OctoBrain統合回答 (Q${q.id}/${q.cat})】\n8つの視点を統合した結論と根拠、見方が分かれる点、次の一手を含む多角的な回答。` +
      (boundary ? "\n(この問いは限界があり、確実でない点は正直に留保します。)" : ""),
    totalCost: 0.0008 + (q.id % 5) * 0.0001,
    ms: 3800 + (q.id % 7) * 200,
    quorum: q.id % 3 === 0 ? "8/8" : "6/8",
    route: "complex",
    fallback: false,
  };
}

function mockB(q: Question): SideBResult {
  return {
    id: q.id,
    side: "b",
    system: "single",
    question: q.q,
    answer: `【単発上位モデル回答 (Q${q.id})】\nまとまってはいるが単一視点の回答。`,
    totalCost: 0.0035 + (q.id % 5) * 0.0003,
    ms: 2100 + (q.id % 6) * 150,
    model: "mock-single",
  };
}

function mockEval(
  q: Question,
  first: string,
  _second: string,
): {
  position1: RubricScore;
  position2: RubricScore;
  honest1: boolean;
  honest2: boolean;
} {
  const boundary = BOUNDARY_IDS.includes(q.id);
  // A(OctoBrain): 深さ・多角性が高め、簡潔さは低め。B(単発): 逆。境界はAの正確さが落ちる。
  const a: RubricScore = {
    depth: boundary ? 3 : 5,
    perspective: boundary ? 3 : 5,
    practicality: 4,
    accuracy: boundary ? 2 : 4,
    conciseness: 3,
  };
  const b: RubricScore = {
    depth: 3,
    perspective: 2,
    practicality: 4,
    accuracy: boundary ? 2 : 4,
    conciseness: 5,
  };
  // 実際の提示順(first/second)に合わせて position を割り当てる。
  // モックA回答には "OctoBrain" が含まれる。
  const firstIsA = first.includes("OctoBrain");
  const aHonest = boundary; // 境界問題では限界を正直に留保する
  const bHonest = false;
  return firstIsA
    ? { position1: a, position2: b, honest1: aHonest, honest2: bHonest }
    : { position1: b, position2: a, honest1: bHonest, honest2: aHonest };
}

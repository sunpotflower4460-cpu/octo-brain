// ルーター (docs/00_architecture.md §3)。
// 超軽量モデルで simple / normal / complex を1語分類。
// 失敗・不正応答時は normal にフォールバックする。

import { callModel } from "./callModel.js";
import type { CostSink, Env, Route } from "../types.js";

// 分類器プロンプト (§3)。全リクエスト固定。
const ROUTER_SYSTEM =
  "次の入力への回答に必要な思考の重さを simple / normal / complex のいずれか1語のみで答えよ。";

export interface RouterOpts {
  env: Env;
  collector?: CostSink;
  signal?: AbortSignal;
}

export async function classifyRoute(
  input: string,
  opts: RouterOpts,
): Promise<Route> {
  try {
    const res = await callModel(
      "router",
      [
        { role: "system", content: ROUTER_SYSTEM },
        { role: "user", content: input },
      ],
      { env: opts.env, collector: opts.collector, signal: opts.signal },
    );
    return parseRoute(res.text);
  } catch {
    // タイムアウト・ネットワーク等はすべて normal フォールバック
    return "normal";
  }
}

// 応答文字列から分類を抽出。判別不能なら normal。
export function parseRoute(text: string): Route {
  const t = text.toLowerCase();
  if (t.includes("complex")) return "complex";
  if (t.includes("simple")) return "simple";
  if (t.includes("normal")) return "normal";
  return "normal";
}

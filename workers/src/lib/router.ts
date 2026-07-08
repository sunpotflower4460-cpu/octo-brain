// ルーター (docs/01_depth_design.md §4.3, §6)。
// 相談のドメイン(領域)を1語分類する。light プランのとき起動する2軸の選択に使う。
// 失敗・不正応答時は general にフォールバックする。判定プロンプトは固定文。

import { callModel } from "./callModel.js";
import type { CostSink, Domain, Env } from "../types.js";

// ドメイン分類プロンプト(§4.3)。全リクエスト固定。
const DOMAIN_SYSTEM =
  "次の相談がどの領域かを、love / work / money / family / self / general のいずれか1語のみで答えよ。love=恋愛・人間関係、work=仕事・キャリア、money=お金・投資、family=家族・育児、self=自分自身の内省、general=それ以外。";

const DOMAINS: Domain[] = ["love", "work", "money", "family", "self", "general"];

export interface RouterOpts {
  env: Env;
  collector?: CostSink;
  signal?: AbortSignal;
}

export async function classifyDomain(
  input: string,
  opts: RouterOpts,
): Promise<Domain> {
  try {
    const res = await callModel(
      "router",
      [
        { role: "system", content: DOMAIN_SYSTEM },
        { role: "user", content: input },
      ],
      { env: opts.env, collector: opts.collector, signal: opts.signal },
    );
    return parseDomain(res.text);
  } catch {
    return "general";
  }
}

// 応答文字列からドメインを抽出。判別不能なら general。
export function parseDomain(text: string): Domain {
  const t = text.toLowerCase();
  for (const d of DOMAINS) {
    if (d !== "general" && t.includes(d)) return d;
  }
  return "general";
}

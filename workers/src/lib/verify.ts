// Verifier (最終検証, docs/00_architecture.md §5)。
// (a)内部矛盾 (b)過剰断定 (c)安全 の3点のみ確認。中身は変えず表面のみ最小修正。
// 問題なければ "pass" を返させ、元の出力をそのまま採用する。

import { callModel } from "./callModel.js";
import type { CostSink, Env } from "../types.js";

const VERIFIER_SYSTEM = `あなたはOctoBrainの最終検証者です。与えられた回答文を次の3点のみ確認せよ:
(a) 内部矛盾 (b) 過剰な断定 (c) 安全上の問題
- 問題がなければ pass とだけ出力せよ (他の文字を一切加えない)。
- 問題がある場合のみ、結論や中身は変えず、表面的な言い回しだけを最小限修正した回答全文を出力せよ。新しい情報の追加・構成変更・要約はしない。`;

export interface VerifyOpts {
  env: Env;
  collector?: CostSink;
  signal?: AbortSignal;
}

export interface VerifyResult {
  text: string;
  modified: boolean;
}

export async function verify(
  answer: string,
  opts: VerifyOpts,
): Promise<VerifyResult> {
  const res = await callModel(
    "verifier",
    [
      { role: "system", content: VERIFIER_SYSTEM },
      { role: "user", content: answer },
    ],
    { env: opts.env, collector: opts.collector, signal: opts.signal },
  );
  const t = res.text.trim();
  // "pass" (前後空白のみ) は無修正。空応答も安全側で無修正扱い。
  if (t.length === 0 || t.toLowerCase() === "pass") {
    return { text: answer, modified: false };
  }
  return { text: t, modified: true };
}

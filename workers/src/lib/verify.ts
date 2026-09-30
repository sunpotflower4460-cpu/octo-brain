// Verifier (最終検証, docs/00_architecture.md §5)。
// (a)内部矛盾 (b)過剰断定 (c)安全 の3点のみ確認。中身は変えず表面のみ最小修正。
// 問題なければ "pass" を返させ、元の出力をそのまま採用する。

import { callModel } from "./callModel.js";
import type { CostSink, Env } from "../types.js";

const VERIFIER_SYSTEM = `あなたはOctoBrainの最終検証者です。与えられた回答文を次の3点のみ確認せよ:
(a) 内部矛盾 (b) 過剰な断定 (c) 安全上の問題
- 問題がなければ pass とだけ出力せよ (他の文字を一切加えない)。
- 問題がある場合のみ、結論や中身は変えず、表面的な言い回しだけを最小限修正した回答全文を出力せよ。新しい情報の追加・構成変更・要約はしない。
- 出力は修正後の回答全文だけ。修正理由・前置き・注記(「〜を修正します」等)は一切書かない。
- 表記ゆれや独特の言い回しは誤りではない。事実や安全に関わらない言葉は直さない。`;

export interface VerifyOpts {
  env: Env;
  collector?: CostSink;
  signal?: AbortSignal;
}

export interface VerifyResult {
  text: string;
  modified: boolean;
  // 修正案を棄却して元の回答を採用した理由(meta.warnings 用)。棄却しなければ undefined
  rejected?: "truncated" | "length_mismatch" | "preamble";
}

// 「表面のみ最小修正」の範囲を外れた書き換え(要約・置換・大幅加筆)を棄却する長さ比。
const MIN_REWRITE_RATIO = 0.7;
const MAX_REWRITE_RATIO = 1.3;

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
  // "pass" および末尾の句読点・感嘆符のみの揺れは無修正扱い。
  // "pass\nOK" や本文を含む応答は修正済みとして採用する。
  if (t.length === 0 || /^pass[.!。]?$/i.test(t)) {
    return { text: answer, modified: false };
  }
  // 出力上限で切れた修正案は採用しない(途中切れの回答で置き換えない)
  if (res.truncated) {
    return { text: answer, modified: false, rejected: "truncated" };
  }
  // 「問題ありません。」等の短文や大幅な書き換えは最小修正ではないので元を採用
  const ratio = t.length / Math.max(1, answer.trim().length);
  if (ratio < MIN_REWRITE_RATIO || ratio > MAX_REWRITE_RATIO) {
    return { text: answer, modified: false, rejected: "length_mismatch" };
  }
  // 検証役が修正理由などの前置きを付けた(回答の書き出しが保たれていない)なら採用しない
  if (!keepsOpening(answer, t)) {
    return { text: answer, modified: false, rejected: "preamble" };
  }
  return { text: t, modified: true };
}

// 修正案が元の回答の書き出しを保っているか。最小修正なら冒頭は変わらないはずで、
// 冒頭に「〜を修正します」などの説明文が付いた修正案を見分ける。
// 回答は利用者の言葉の引用「…」で始まるので、冒頭5文字は最小修正では変わらない。
function keepsOpening(original: string, revised: string): boolean {
  const head = original.trim().slice(0, 5);
  return head.length === 0 || revised.trim().startsWith(head);
}

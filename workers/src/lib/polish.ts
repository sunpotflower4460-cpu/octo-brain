// 回答の最終整形(LLM を使わない決定的な後処理)。
// - 冒頭の引用が利用者の入力に無い(腕の意見などを引用した)ときは、その引用段落を外す
// - モデルがまれに混ぜる異体の記号(アラビア語の疑問符など)・ゼロ幅文字を直す
// 直した内容は fixes に返し、meta.warnings で可視化する(本文はログに出さない)。

const QUOTE_OPENING = /^(?:「([^」\n]+)」|『([^』\n]+)』|“([^”\n]+)”|"([^"\n]+)")\s*(?:\n|$)/;

// 比較用の正規化: 空白と括弧類を除き、全角の ?! を半角にそろえる
function normalize(s: string): string {
  return s
    .replace(/[\s「」『』“”"']/g, "")
    .replace(/？/g, "?")
    .replace(/！/g, "!");
}

// dropOpeningQuote: 寄り添いモードでは、入力にある引用でも冒頭から外す
// (つらさを打ち明けた言葉を見出しのように引用し返すと機械的に響くため)。
export function polishAnswer(
  answer: string,
  input: string,
  opts: { dropOpeningQuote?: boolean } = {},
): { text: string; fixes: string[] } {
  const fixes: string[] = [];
  let text = answer;

  // 異体の記号・不可視文字
  const cleaned = text.replace(/؟/g, "？").replace(/[​-‍﻿]/g, "");
  if (cleaned !== text) {
    fixes.push("odd_chars_fixed");
    text = cleaned;
  }

  // 冒頭の引用が入力に無ければ外す(「利用者の言葉を拾う」という体験を偽らない)
  const m = QUOTE_OPENING.exec(text.trimStart());
  if (m) {
    const quoted = m[1] ?? m[2] ?? m[3] ?? m[4] ?? "";
    const q = normalize(quoted);
    if (q.length > 0 && !normalize(input).includes(q)) {
      text = text.trimStart().slice(m[0].length).trimStart();
      fixes.push("misquote_removed");
    } else if (opts.dropOpeningQuote) {
      text = text.trimStart().slice(m[0].length).trimStart();
    }
  }
  return { text, fixes };
}

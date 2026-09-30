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
    } else if (opts.dropOpeningQuote || q.length >= normalize(input).length * 0.8) {
      // 寄り添いモード、または入力をほぼ丸ごと繰り返しているだけの引用は外す
      // (相談文は画面上ですぐ上に表示されているので、丸ごとの繰り返しは機械的に見える)
      text = text.trimStart().slice(m[0].length).trimStart();
    }
  }
  return { text, fixes };
}

// ストリーミング用: 冒頭の引用段落を流さずに捨てるフィルター(寄り添いモード用)。
// 完了時の polishAnswer でも外すが、ストリーム中に一瞬表示されてから消えるちらつきを防ぐ。
const QUOTE_OPENERS = ["「", "『", "“", '"'];
const MAX_HOLD = 400; // これ以上たまっても判定できなければ、そのまま流す
// ストリームでは段落の終わり(改行)まで確定しないので、文末($)では判定しない
const QUOTE_LINE = /^(?:「[^」\n]+」|『[^』\n]+』|“[^”\n]+”|"[^"\n]+")[^\S\n]*\n\s*/;

export class LeadingQuoteFilter {
  private buf = "";
  private decided = false;

  push(t: string): string {
    if (this.decided) return t;
    this.buf += t;
    const s = this.buf.trimStart();
    if (s.length === 0) return "";
    if (!QUOTE_OPENERS.includes(s[0])) return this.release(this.buf);
    // 引用の段落が閉じる(改行が来る)まで待ち、段落ごと捨てる
    const m = QUOTE_LINE.exec(s);
    if (m) {
      const rest = s.slice(m[0].length);
      // 引用の直後がまだ空白だけなら、本文の始まりまで待つ
      if (rest.length === 0) return "";
      return this.release(rest);
    }
    if (this.buf.length > MAX_HOLD) return this.release(this.buf);
    return "";
  }

  flush(): string {
    return this.decided ? "" : this.release(this.buf);
  }

  private release(out: string): string {
    this.decided = true;
    this.buf = "";
    return out;
  }
}

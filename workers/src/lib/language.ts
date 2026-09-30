// 回答言語の判定(LLM を使わない)。腕の意見は日本語で返るため、英語の入力でも統合脳が
// 日本語に引きずられる(品質確認で再現)。入力に日本語の文字が無く英字があれば英語と判定し、
// 統合脳への user メッセージに明示する。

const JAPANESE = /[぀-ヿ㐀-鿿]/;
const LATIN_WORD = /[A-Za-z]{2,}/g;

export function answerLanguage(input: string): "ja" | "en" {
  if (JAPANESE.test(input)) return "ja";
  return (input.match(LATIN_WORD)?.length ?? 0) >= 2 ? "en" : "ja";
}

// 統合脳の user メッセージに添える回答言語の指示。日本語なら何も足さない。
export function languageDirective(input: string): string | null {
  return answerLanguage(input) === "en"
    ? "[回答言語]\nEnglish。入力が英語のため、回答本文(引用・次の一歩・問いを含む)はすべて英語で書く。機械可読ブロックの JSON と要約は日本語のままでよい。"
    : null;
}

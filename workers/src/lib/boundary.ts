// P4 境界の正直さ (docs/ROADMAP P4 / 01_depth_design §9)。
// LLM を使わず入力を軽く走査し、モデルが不得手な領域(正確な計算・最新/リアルタイム情報)を
// 検出する。検出したら回答冒頭に「概算しかできない/最新情報は持っていない」と正直に添える。
// 誤検出でユーザーを煩わせないよう、パターンは保守的に絞る(取りこぼしより誤爆を避ける)。

export type BoundaryKind = "math" | "recency";

// 正確な計算・数式(概算しかできない領域)
const MATH_PATTERNS: RegExp[] = [
  /\d+\s*[+\-*/×÷^]\s*\d+/, // 12*34 のような算術式
  /(平方根|√|方程式|不等式|微分|積分|因数分解|対数|順列|組み合わせ|標準偏差)/,
  /(計算|算出)(して|し|する|せよ|してくれ|してください|して欲しい|してほしい)/,
];

// 最新・リアルタイム情報(モデルは持っていない領域)
const RECENCY_PATTERNS: RegExp[] = [
  /(最新|リアルタイム|速報|直近)/,
  /(株価|為替|円相場|為替レート|時価総額|仮想通貨|ビットコイン)(は|を|が|の|って)?/,
  /(今日|本日|現在|今の|今週|昨日).{0,8}(天気|気温|ニュース|価格|株価|為替|相場|レート|順位|ランキング|結果|状況)/,
  /(今|直近)の(ニュース|天気|気温|相場|価格|レート|順位|ランキング|流行)/,
  /(ニュース|天気予報)(を|は)?(教えて|知りたい)/,
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(text));
}

// 入力から境界種別を返す。該当なしは null。math を recency より優先(算術式は明確)。
export function detectBoundary(input: string): BoundaryKind | null {
  const t = input ?? "";
  if (matchesAny(t, MATH_PATTERNS)) return "math";
  if (matchesAny(t, RECENCY_PATTERNS)) return "recency";
  return null;
}

// 回答冒頭に添える正直な但し書き。誤魔化さないことを信頼性にする。
export function boundaryPrefix(kind: BoundaryKind): string {
  switch (kind) {
    case "math":
      return "※ 正確な計算や数値の断定は苦手です。以下は考え方・概算として読んでください。";
    case "recency":
      return "※ 最新・リアルタイムの情報は持っていません。一般的な考え方としてお答えします。";
  }
}

// 回答本文に但し書きを前置きする(境界なしはそのまま)。
export function withBoundaryPrefix(answer: string, kind: BoundaryKind | null): string {
  if (!kind) return answer;
  return `${boundaryPrefix(kind)}\n\n${answer}`;
}

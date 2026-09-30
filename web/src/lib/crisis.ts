// 危機レベルの内容(方法・手段・自傷・自殺の言及)の検出。通信失敗などでサーバーの判断
// (meta.careOffer)が無いときの予備にだけ使う。軽い「消えたい」の吐露では窓口を出さない
// (段階の判断はサーバーの workers/src/lib/care.ts が正)。
// 電話番号は公的・公益の窓口(2026-09 時点)。変更時はここだけ直す。

const PATTERNS: RegExp[] = [
  /自殺|自死|首を吊|首をつ|飛び降り|とびおり|練炭|OD(する|した|しよう)|オーバードーズ|遺書/,
  /リスカ|リストカット|自傷|自分を傷つけ|手首を切/,
  /(死ぬ|死ねる|消える|楽になれる|楽に死ねる)方法|楽に死/,
  /suicid|kill myself|end my life|self[- ]?harm|how to die/i,
];

export function detectCrisis(text: string): boolean {
  return PATTERNS.some((p) => p.test(text));
}

export interface Hotline {
  name: string;
  tel: string; // tel: リンク用(ハイフンなし)
  display: string;
  hours: string;
}

export const HOTLINES: Hotline[] = [
  { name: "よりそいホットライン", tel: "0120279338", display: "0120-279-338", hours: "24時間・無料" },
  { name: "いのちの電話", tel: "0570783556", display: "0570-783-556", hours: "10時〜22時" },
  { name: "こころの健康相談統一ダイヤル", tel: "0570064556", display: "0570-064-556", hours: "時間は地域により異なる" },
];

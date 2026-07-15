// アプリのメタ情報と外部リンク (P9 申請要件)。
// App Review では「不適切な出力を報告する導線」(ガイドライン1.2)と、
// プライバシーポリシー/利用規約への導線が求められる。

// 表示バージョン。ネイティブ(iOS)のバージョンは Xcode/Info.plist 側が正。ここは表示用。
export const APP_VERSION = "1.0.0";

// 問い合わせ・不適切コンテンツ報告先。← あなたの連絡先に変更可(App Review では実在する連絡先が必要)。
export const SUPPORT_EMAIL = "sunpotflower4460@gmail.com";

// プライバシーポリシー / 利用規約の公開URL。ホスティング後に実URLへ差し替える
// (例: GitHub Pages)。"SET_ME" のままなら UI にリンクを出さない。
export const PRIVACY_URL = "SET_ME";
export const TERMS_URL = "SET_ME";

export function isConfiguredUrl(url: string): boolean {
  return /^https?:\/\//.test(url) && !url.includes("SET_ME");
}

// 報告メールの mailto(件名・本文をプリフィル)。生の内部情報は含めない。
export function reportMailto(): string {
  const subject = encodeURIComponent(`[OctoBrain] 問題の報告 (v${APP_VERSION})`);
  const body = encodeURIComponent(
    "気になった点や不適切だと感じた出力について、差し支えない範囲でお書きください。\n\n" +
      "―― 以下は任意 ――\n" +
      "・どんな入力でしたか:\n" +
      "・どんな出力が問題でしたか:\n",
  );
  return `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
}

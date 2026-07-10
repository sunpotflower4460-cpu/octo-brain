# ネイティブ アイコン & スプラッシュ 素材

OctoBrain の「顔」となるアプリアイコン/スプラッシュの**元データ**(SVG)。
Web の favicon / PWA アイコンは `web/public/icon.svg` が正。ここはネイティブ生成の入力。

- `icon.svg` — 1024×1024。中央脳(Core)+ 8腕(=8レンズ)+ 4軸。
- `splash.svg` — 2732×2732。深海背景に Core を中央配置 + ワードマーク。

## 各サイズの PNG 生成(P7・macOS/Xcode 環境で実施)

ネイティブ各解像度は [`@capacitor/assets`](https://github.com/ionic-team/capacitor-assets) で生成する。
このツールは `sharp` に依存し、iOS/Android プロジェクト(`npx cap add ios` 等)が
存在している前提のため、**実機ビルド環境(P7)で実行する**。

```bash
# 前提: web/ios, web/android が生成済み(P7)
cd web
npx @capacitor/assets generate \
  --iconBackgroundColor '#050711' \
  --splashBackgroundColor '#050711'
```

生成物(`ios/App/App/Assets.xcassets`, `android/app/src/main/res/...`)は
実機プロジェクトと一緒にコミットする(本フェーズ P6 の範囲外)。

> 注: 本リポジトリは Linux CI 環境のため PNG 生成・実機ビルドは行わない。
> P6 では素材と設定の土台のみを用意し、生成・検証は P7 に送る。

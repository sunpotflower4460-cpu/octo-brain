# iOS ビルド手順(P7) — macOS/Xcode で実施

> **2026-09-30 更新**: `web/ios/` は生成・コミット済み(Swift Package Manager 構成。CocoaPods 不要)。
> Info.plist(iPhone 専用・縦固定・`ITSAppUsesNonExemptEncryption=false`)、`PrivacyInfo.xcprivacy`、
> アイコン/スプラッシュ、本番 API の URL は設定済み。iOS シミュレーター(iPhone 17 / iOS 26)で
> 同意 → 送信 → 本番 API からのストリーミング回答まで動作確認済み。
> 残る手動作業は **署名(Team 選択)→ 実機確認 → Archive → TestFlight**。

## 前提

- macOS + Xcode 26 以降、Apple Developer Program 登録済み(CocoaPods は不要)
- Node は本リポジトリと同じメジャー、`web/` で `npm ci` 済み(SPM が `node_modules/@capacitor/*` を参照する)

## 1. 本番 API を指す(設定済み)

`web/.env.production` は `VITE_API_BASE=https://octo-brain.sunpotflower4460.workers.dev`。
https 以外や SET_ME のままだと `npm run build` が失敗する(`vite.config.ts` のガード)。

Workers 側:
```bash
# 本番デプロイ + シークレット(リポジトリに書かない)
cd workers
wrangler kv namespace create OCTO_KV        # 出た id を wrangler.toml に反映
wrangler kv namespace create OCTO_KV --preview
wrangler secret put DEEPSEEK_API_KEY        # 使用プロバイダー分だけ
# wrangler.toml の [vars] ALLOWED_ORIGIN は capacitor:// 系を CORS 済みなので通常不要
npm run deploy
```

## 2. Web をビルドして iOS プロジェクト生成

```bash
cd web
npm run build                 # dist/ を生成(.env.production が効く)
npx cap sync ios              # dist/ とプラグインを同期(ios/ は生成済み。add は不要)
```

## 3. アイコン & スプラッシュ生成(生成済み。素材を変えたときだけ)

```bash
# 素材は web/resources/{icon.png(1024²), splash.png(2732²)} を用意済み
cd web
npx @capacitor/assets generate --ios \
  --iconBackgroundColor '#050711' \
  --splashBackgroundColor '#050711'
```

## 4. Xcode 設定

```bash
npx cap open ios
```
- Signing & Capabilities: Team を選択、Bundle ID = `com.octobrain.app`(App Store Connect で同じ ID を登録)
- 設定済み: iPhone 専用(TARGETED_DEVICE_FAMILY=1)・iOS 15.0 以上・Version 1.0.0 / Build 1・縦固定
- 提出のたびに Build 番号(CURRENT_PROJECT_VERSION)を上げる
- `PrivacyInfo.xcprivacy` の収集データ(ユーザーコンテンツ・デバイスID、いずれも非リンク・非トラッキング)と
  App Store Connect の「App のプライバシー」回答を一致させる
- 端末で実行し、**Safe Area(下部入力)・キーボード表示・fps・発熱**を確認(ROADMAP P7 完了目安)

## 5. アーカイブ → TestFlight

- Product > Archive → Distribute App → App Store Connect → Upload
- App Store Connect で TestFlight 内部テスト(自分の端末)→ 問題なければ審査提出

## 6. devicePixelRatio(Retina)確認

Living Core の Canvas は `min(devicePixelRatio, 2)` で描画済み。実機でぼやけ・発熱を確認し、
必要なら `web/src/features/cognition/CoreCanvas.tsx` の DPR 上限を調整(解像度対応は忠実度向上として許可)。

## トラブル時

- 401/403(API): `wrangler secret` のキー、`VITE_API_BASE`、CORS を確認
- 白画面: `npx cap sync` 忘れ / `dist` 未生成
- シミュレーターで日本語が「?」の四角になる: iOS 26 シミュレーターの WebKit の CJK フォント欠落(Safari でも同じ)。
  実機では起きない。レイアウト確認は実機で行う

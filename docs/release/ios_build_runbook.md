# iOS ビルド手順(P7) — macOS/Xcode で実施

> この環境(Linux)では実行できない**手動作業**。web/ は Capacitor 互換に整備済みで、
> Capacitor 設定・アイコン素材・本番 CORS は導入済み。以下は macOS 上の手順。

## 前提

- macOS + Xcode(最新)+ CocoaPods、Apple Developer Program 登録済み
- Node は本リポジトリと同じメジャー、`web/` で `npm ci` 済み

## 1. 本番 API を指す

```bash
# web/.env.production の VITE_API_BASE を本番 Workers URL に設定
#   VITE_API_BASE=https://octo-brain.<account>.workers.dev
```

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
npx cap add ios               # ios/ を生成(初回のみ)
npx cap sync ios              # dist/ とプラグインを同期
```

## 3. アイコン & スプラッシュ生成

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
- Signing & Capabilities: Team を選択、Bundle ID = `com.octobrain.app`
- Deployment Target / Display Name(OctoBrain)/ Version(1.0.0)/ Build(1)
- Info.plist: ダーク前提の StatusBar は P6 の設定 + `apple-mobile-web-app-status-bar-style` 済み
- 端末で実行し、**Safe Area(下部入力)・キーボード表示・fps・発熱**を確認(ROADMAP P7 完了目安)

## 5. アーカイブ → TestFlight

- Product > Archive → Distribute App → App Store Connect → Upload
- App Store Connect で TestFlight 内部テスト(自分の端末)→ 問題なければ審査提出

## 6. devicePixelRatio(Retina)確認

Living Core の Canvas は `min(devicePixelRatio, 2)` で描画済み。実機でぼやけ・発熱を確認し、
必要なら `web/src/features/cognition/CoreCanvas.tsx` の DPR 上限を調整(解像度対応は忠実度向上として許可)。

## トラブル時

- 401/403(API): `wrangler secret` のキー、`VITE_API_BASE`、CORS を確認
- 白画面: `npx cap sync` 忘れ / `dist` 未生成 / `VITE_API_BASE` が SET_ME のまま

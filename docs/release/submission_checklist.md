# App Store 申請 マスターチェックリスト

> 目的: **自動でできることは完了済み**にし、残りは**手動(macOS / App Store Connect / 実機 / 課金 / キー)**だけ、という状態を1枚で示す。
> ✅ = このリポジトリで完了 / ☐ = あなたの手動作業(この環境では不可)。

## A. 完了済み(自動)✅

- ✅ プロダクト実装: 8ノード並列 + 統合 + 検証、深化(TENSION)・共鳴(RESONANCE)
- ✅ 世界水準 UI/UX(P2.7)+ 初見の分かりやすさ磨き込み + アクセシビリティ(WCAG 2.2 AA 相当)
- ✅ 会話の端末内永続化・オンボーディング・設定・オフライン
- ✅ 堅牢化(P5): クォータ実ブロック(429)・連打防止・全体タイムアウト予算(504)・`ops:report`
- ✅ 境界の正直さ(P4): 計算/最新情報は正直に留保
- ✅ Capacitor 土台(P6)+ 本番 CORS(`capacitor://localhost` 等)+ `@capacitor/ios` 依存
- ✅ アプリ内 App Review 要件: 「問題を報告」(ガイドライン1.2)・規約/プライバシーリンク枠・バージョン表示
- ✅ アイコン/スプラッシュ元素材(`web/resources/{icon,splash}.png`)
- ✅ App Store スクショ5枚(6.7", 1290×2796 / `docs/release/screenshots/`)
- ✅ 申請書類ドラフト: プライバシーポリシー・利用規約・App Store Connect 記入内容・審査ノート
- ✅ runbook: iOS ビルド(P7)・課金(P8)・運用(P10)

## B. 手動で残る作業(順番どおり)☐

### B0. 事前に埋める値(`[要記入]`/`SET_ME`)
- ☐ `docs/legal/*` の事業者名・最終更新日・管轄・LLM プロバイダー名
- ☐ `web/src/config/appInfo.ts` の `PRIVACY_URL` / `TERMS_URL`(ホスティング後の実URL)、必要なら `SUPPORT_EMAIL`
- ☐ `web/.env.production` の `VITE_API_BASE`(本番 Workers URL)
- ☐ `docs/release/app_store_connect.md` の SKU・サポートURL 等

### B1. バックエンド本番化(要 LLM API キー)
- ☐ `workers/src/config/models.ts` の `SET_ME`(モデル/価格)を**本番ベンチ**で確定(→ `docs/phases/P4_tuning.md`)
- ☐ `wrangler kv namespace create` で KV を作り `wrangler.toml` に id 反映
- ☐ `wrangler secret put`(各プロバイダーキー)/ `npm run deploy`

### B2. ホスティング(プライバシー/規約の公開URL)
- ☐ `docs/legal/*.md` を公開URL化(例: GitHub Pages)→ App Store Connect と `appInfo.ts` に設定

### B3. iOS ビルド(要 macOS/Xcode/実機)
- ☐ `docs/release/ios_build_runbook.md` に沿って `cap add ios` → assets 生成 → 署名 → 実機確認(Safe Area/キーボード/fps/発熱)→ Archive → TestFlight

### B4. 課金(任意・要 App Store Connect)
- ☐ `docs/release/iap_plan.md` に沿って products 作成・RevenueCat 接続・サンドボックス検証(未課金でも完結を維持)

### B5. App Store Connect 入力
- ☐ `docs/release/app_store_connect.md` を転記(基本情報・説明・キーワード・App Privacy・年齢・**審査ノート**)
- ☐ スクショ(`docs/release/screenshots/`)をアップロード
- ☐ 年齢レーティング 17+、価格/提供地域

### B6. 提出・運用
- ☐ 段階的リリース(7日)ON → 審査提出
- ☐ 日次 `npm run ops:report`(`docs/release/ops_runbook.md`)

## C. 既知の注意
- 表示テキストがモックのスクショは、実データやキャッチコピー入りに差し替え可
- 「最強/No.1」等の誇大表現は避ける(P3 の数字ベースで)
- 広告(AdMob)を入れる場合は App Privacy / ATT / SKAdNetwork を更新

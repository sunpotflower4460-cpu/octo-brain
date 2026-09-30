# 運用 runbook(P10)

## 日次

```bash
cd workers
npm run ops:report -- --days 1        # 当日の 総コスト/件数/平均ms/fallback率/内訳
npm run ops:report -- --days 7        # 週次の傾向
```

見るポイント:
- **総コスト**が想定(`docs/pricing_notes.md`)を超えていないか
- **fallback率**(部分失敗)が上がっていないか → プロバイダー不調のサイン
- **平均ms** の悪化 → タイムアウト予算(`REQUEST_BUDGET_MS`)に当たっていないか

## プロバイダー障害・混雑時(自動)

- 主のプロバイダー(OpenAI GPT-6 Luna)が 429(1分あたりの上限)・5xx・接続失敗なら、
  **自動で DeepSeek に切り替えて**回答する(両方のキーがあるとき)。原価ログの calls に `fallback: true`
- 実測した OpenAI の上限(2026-09-30): gpt-6-luna は 500 リクエスト/分・20万トークン/分。
  1問約6,000トークンなので、およそ30問/分がトークン上限。原価ログの `rl` に毎回の残量が記録される
- 構成の切り替え(`workers/wrangler.toml` の vars を変えて `npm run deploy`):
  - `MODEL_PROFILE = "deepseek" | "luna"`(未指定なら OPENAI_API_KEY があれば luna)
  - `MODEL_FALLBACK = "off"` で自動切り替えを止める
  - `LUNA_SYNTH_REASONING = "none" | "low" | "medium" | "high"`(統合脳だけの推論。既定 low)

## コスト管理(課金なし運用)

| 仕組み | 設定 | 既定値 |
|---|---|---|
| 全体の1日予算 | `DAILY_BUDGET_USD` | $3。70%で軽いモード(ディープもライト・推論なし)、100%で当日停止 |
| 1人の月間枠 | `FREE_MONTHLY_QUOTA` | 100単位(ディープ・深掘りは2) |
| 1人の1日枠 | `FREE_DAILY_QUOTA` | 20単位 |
| 同一IPの1日枠 | `IP_DAILY_QUOTA` | 300単位 |
| IP のバースト | Rate Limiting バインディング | 20回/60秒 |
| ディープの提供 | `DEEP_PLAN_ENABLED` | "true"(原価が厳しいときに "false") |

- 当日にすでに使った額: `spend:{yyyymmdd}:{0-15}` の合計(マイクロドル)
- 停止する日が増えたら `DAILY_BUDGET_USD` を引き上げる(上げた額が1日に払ってよい上限)
- 二重の歯止めとして、OpenAI 側でも月額上限を設定しておく(platform.openai.com/settings/organization/limits)

## リリース運用

- App Store の**段階的リリース(7日)**を ON
- モデル価格改定ウォッチ: 月1で `models.ts` の `pricePerMTok*` を更新
- レビュー返信・ASO 微調整

## モニタリングのキー(KV)

- `cost:{yyyymmdd}:{requestId}` … 原価ログ(90日失効、本文なし)。calls[].rl に1分あたり上限の残量、fallback に切り替え
- `quota:{clientId}:{yyyymm}` … "月間|yyyymmdd|当日" の利用単位(62日失効)
- `spend:{yyyymmdd}:{0-15}` … 全体の1日原価(16分割、3日失効)
- `ipq:{ip}:{yyyymmdd}` … 同一IPの1日利用単位(2日失効)
- `rl:{clientId}` … 連打防止状態(短命)

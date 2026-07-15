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

## プロバイダー障害時

第一対応は **`workers/src/config/models.ts` の1行差し替え**(モデル/baseURL/keyEnv)→ `npm run deploy`。
頻発するなら callModel に第二候補フォールバックを追加(フェーズ化)。

## コスト暴走時

- 第一防壁: クォータ(`FREE_MONTHLY_QUOTA`)+ 連打防止(P5, 実装済み)
- 第二防壁(必要なら): 日次コスト上限の全体ブレーカー(超過で全リクエストを light に落とす)を追加

## リリース運用

- App Store の**段階的リリース(7日)**を ON
- モデル価格改定ウォッチ: 月1で `models.ts` の `pricePerMTok*` を更新
- レビュー返信・ASO 微調整

## モニタリングのキー(KV)

- `cost:{yyyymmdd}:{requestId}` … 原価ログ(90日失効、本文なし)
- `quota:{clientId}:{yyyymm}` … 月間利用回数(62日失効)
- `rl:{clientId}` … 連打防止状態(短命)

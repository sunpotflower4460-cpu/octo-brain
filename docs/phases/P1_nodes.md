# P1 — 並列ノード・統合・検証パイプライン

## 目的

OctoBrainの心臓部を完成させる。`POST /api/analyze` に入力を投げると、
ルーティング → 並列ノード → 統合 → 検証 → 原価ログ を通った一括JSONが返る状態。

前提: P0完了。仕様の詳細はすべて `docs/00_architecture.md` §1〜§9 に従う。

## 実装内容

### 1. ノード定義 `src/config/nodes.ts`

- §2の8動詞ノードを定義: `{ id, verb(内部プロンプト1行), uiName, emoji }`
- 共通システムプロンプト(§2)は定数として1箇所に。**全リクエストで完全固定**(キャッシュのため、動的な文字列埋め込み禁止。ユーザー入力はuserメッセージへ)

### 2. Router `src/lib/router.ts`

- §3のとおり。`callModel("router", ...)` で1語分類、失敗・不正応答時は `normal`
- `mode` 明示指定時はスキップ

### 3. ノード並列実行 `src/lib/runNodes.ts`

- 起動ノードごとに `callModel("node", ...)` を `Promise.allSettled` で並列実行
- 各ノードに `AbortController` で8秒タイムアウト
- JSONパース: 生パース → 失敗なら `{...}` 抽出を1回 → 失敗なら `parse_error` で棄却
- points各60字・最大3の検証(超過は切り詰め)、confidenceの範囲クランプ
- 戻り値: `NodeResult[]` (`status: ok | timeout | parse_error | error`)
- クォーラム判定(§3の表)。未達なら `fallback: true` を返す
- (任意) `NODE_MODEL_POOL` があればノードindexで振り分け

### 4. Synthesizer `src/lib/synthesize.ts`

- §4の手続き化システムプロンプト(固定)
- user側: `[会話要約(あれば)] + [今回の入力] + [okノードのJSONレポート配列]`
- フォールバック時: ノードレポートなしで同モデル単発回答
- 応答の末尾に更新版ローリング要約を作らせる設計にはせず、**別呼び出しにもせず**、統合プロンプト内で「回答本文の後に区切り行 `---SUMMARY---` を置き、300字以内の更新版会話要約を出力せよ」と指示して1回で両方得る(パース失敗時は旧要約を維持)

### 5. Verifier `src/lib/verify.ts`

- §5のとおり。`"pass"` 応答なら元の出力をそのまま採用

### 6. 原価ログ・クォータ `src/lib/costlog.ts`

- §8のKVスキーマで書き込み。リクエスト内の全 `callModel` レコードを集約して1件保存
- `quota:{clientId}:{yyyymm}` をインクリメント。上限チェックはこの段階では「読んで返すだけ」(`meta.quotaUsed`)。ブロックはしない

### 7. エンドポイント `POST /api/analyze`

- §9のP1契約どおりの一括JSON
- 入力バリデーション: `input` 必須・4000字以内、`summary` 500字以内、`clientId` 必須
- パイプライン全体を try/catch し、部分的な失敗は `meta` に反映(握りつぶさない)

### 8. テスト (Vitest, 外部APIすべてモック)

- ルーター: 正常分類 / 不正応答→normal
- クォーラム: 8起動で5成功→続行、4成功→fallback
- タイムアウトノードが `timeout` になり全体は止まらない
- 壊れたJSON→抽出成功 / 抽出失敗→parse_error
- Synthesizer入力の構築(除外ルール: flag付き・空points・confidence<0.4の格下げが機能しているか)
- `---SUMMARY---` パース(あり/なし)
- 原価ログの集約(呼び出し数と合計コスト)

## 受け入れ条件

- [ ] `.dev.vars` にキーを入れた状態で、curl一発で実際の統合回答が返る(手順をworkers/README.mdに追記)
- [ ] レスポンスの `nodes` に全起動ノードのstatusが含まれ、`meta` に route/quorum/totalCost/ms が入る
- [ ] ノードを意図的に1つタイムアウトさせても(モックテストで)回答が返る
- [ ] KVに cost レコードと quota インクリメントが書かれる
- [ ] Vitest 全緑

## やらないこと

SSE / フロント / クォータによるブロック / キャッシュ最適化の追い込み — P2以降。

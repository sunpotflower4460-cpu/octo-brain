# octo-brain / workers

Cloudflare Workers + Hono バックエンド。全体設計は [`../docs/00_architecture.md`](../docs/00_architecture.md)。
このディレクトリは **P0 (骨格・キー秘匿・モデル抽象化)** のスコープ。

## セットアップ

```bash
cd workers
npm install
cp .dev.vars.example .dev.vars   # 実キーを記入 (.dev.vars は .gitignore 済み)
```

`wrangler.toml` の KV ID はプレースホルダー。実際に KV を使うフェーズ (P1) の前に作成する:

```bash
wrangler kv namespace create OCTO_KV
wrangler kv namespace create OCTO_KV --preview
# 出力された id / preview_id を wrangler.toml に差し替える
```

## モデル設定

差し替えは [`src/config/models.ts`](src/config/models.ts) の1行編集で完結する。
初期状態は全モデルが `model: "SET_ME"` のプレースホルダー。実装者が最新の
モデル/価格 (`pricePerMTokIn` / `pricePerMTokOut`, USD) を確認して設定すること。
モデル名の文字列を他ファイルに書かないこと。

## 動作確認

### ヘルスチェック

```bash
npm run dev
# 別ターミナルで:
curl http://localhost:8787/api/health
# => {"ok":true,"version":"0.0.0-p1"}
```

### 実モデル疎通 (ping-model)

`.dev.vars` に該当プロバイダのキーを入れ、`models.ts` の `model` / `baseURL` を
実値に設定してから:

```bash
curl -X POST http://localhost:8787/api/dev/ping-model \
  -H 'content-type: application/json' \
  -d '{"role":"node"}'
# => {"ok":true,"role":"node","text":"pong", ...}
```

`role` は `router` | `node` | `synth` | `verifier`。
このルートは `ENVIRONMENT === "production"` のとき 404 で無効になる。

### 分析 (analyze) — P1

`.dev.vars` にキーを入れ、`models.ts` の `model` / `baseURL` を実値に設定してから、
curl一発で「ルーティング → 並列ノード → 統合 → 検証」を通った一括JSONが返る:

```bash
curl -X POST http://localhost:8787/api/analyze \
  -H 'content-type: application/json' \
  -d '{"input":"新機能を追加すべきか迷っている","clientId":"dev-uuid-1234"}'
```

リクエスト:

```jsonc
{
  "input": "string (必須, 4000字以内)",
  "summary": "string (任意, 500字以内。前回返ってきた meta.summary を渡す)",
  "mode": "auto | simple | normal | complex (任意, 既定 auto)",
  "clientId": "string (必須, フロント生成のUUID)"
}
```

レスポンス (200):

```jsonc
{
  "answer": "最終回答",
  "summary": "更新版ローリング要約 (次回 summary に渡す)",
  "nodes": [ { "id": "counter", "status": "ok", "points": ["..."], "confidence": 0.8 } ],
  "meta": {
    "route": "normal", "quorum": "4/4", "fallback": false,
    "verified": "pass", "totalCost": 0.0012, "ms": 4200, "quotaUsed": 3
  }
}
```

- `mode` を明示するとRouterをスキップする(`complex` で常時8基起動)。
- クォーラム未達時は `meta.fallback: true` になり、統合脳の単発回答を返す。
- 原価ログ (`cost:{yyyymmdd}:{requestId}`) とクォータ (`quota:{clientId}:{yyyymm}`) が KV に書かれる。
  ローカルでは Miniflare のローカルKVに保存される。
- KV書き込み等の部分失敗は `meta.warnings` に載せて可視化する(握りつぶさない)。

### 分析 (ストリーミング) — P2

`POST /api/analyze/stream`(リクエストボディは `/api/analyze` と同じ)。
`text/event-stream` で SSE イベントを逐次送出する:

```
event: phase   data: {"phase":"routing"|"nodes"|"synth"|"verify"}
event: node    data: {"id":"counter","status":"ok","points":[...],"confidence":0.8}
event: token   data: {"t":"..."}
event: done    data: { answer, summary, nodes, meta }   // 一括JSONと同形
event: error   data: {"message":"..."}
```

- ノードは完了した順に `node` を送る。
- Synthesizer は provider のストリーミングで `token` を逐次送出。`---SUMMARY---`
  以降はクライアントに流さずサーバー側で切って `done` の `summary` に含める。
- Verifier はストリーム完了後に実行。修正時は `done` の `answer` を差し替え
  (`meta.verified: "modified"`)。ストリーム表示と最終文面が変わりうる設計。
- 一括JSON版 `/api/analyze` は残置(ベンチ P3 用)。

```bash
curl -N -X POST http://localhost:8787/api/analyze/stream \
  -H 'content-type: application/json' \
  -d '{"input":"新機能を追加すべきか","clientId":"dev-uuid-1234"}'
```

### テスト

```bash
npm test        # Vitest (外部APIはモック)
npm run typecheck
```

## シークレット運用

- **本番**: `wrangler secret put DEEPSEEK_API_KEY` (等、`.dev.vars.example` のキー名)
- **開発**: `workers/.dev.vars` に記載 (コミット禁止)
- キーの実値をリポジトリに書かない。`git grep` で検出されない状態を保つ。

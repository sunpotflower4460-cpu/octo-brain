# P0 — Workers骨格・キー秘匿・モデル抽象化

## 目的

Cloudflare Workers + Hono のバックエンド骨格を作り、
**(a) APIキーがリポジトリに一切存在しない状態**と
**(b) モデルの差し替えが設定1行で済む状態**を確立する。

## スコープ

`workers/` ディレクトリの新規作成のみ。フロントエンド・ノードパイプラインは触らない。

## 実装内容

### 1. プロジェクト初期化

- `workers/` に wrangler + Hono + TypeScript のプロジェクトを作成
- `wrangler.toml`: KVネームスペースのバインディング定義 (`OCTO_KV`)。IDはプレースホルダーでよい(コメントで作成コマンドを併記)
- `.gitignore` に `.dev.vars`, `node_modules`, `.wrangler` を追加
- `.dev.vars.example` を作成 (キー名のみ、値は空) — 使う環境変数名の一覧を兼ねる

### 2. モデル設定 `src/config/models.ts`

`docs/00_architecture.md` §7 の型定義どおりに実装。

- `MODELS` の各エントリは `model: "SET_ME"` のプレースホルダーで作成し、ファイル冒頭コメントに
  「実装者が最新のモデル/価格を確認して設定すること。単価(`pricePerMTokIn/Out`, USD)も併記」と明記
- `provider` は `"openai-compat"` | `"gemini"` | `"anthropic"` の3種を型で定義

### 3. モデル抽象化 `src/lib/callModel.ts`

```ts
callModel(role: ModelRole, messages: ChatMessage[], opts?: { maxTokens?, signal?, modelOverride? })
  → { text: string, inTok: number, outTok: number, ms: number }
```

- `provider` に応じてリクエスト形式を変換:
  - `openai-compat`: `{baseURL}/chat/completions` (DeepSeek / Mistral / OpenAI がこの1実装で使える)
  - `gemini`: `generateContent` 形式 (systemInstruction 対応)
  - `anthropic`: `/v1/messages` 形式
- `maxTokens` は必ずAPIパラメータとして送る
- usage(トークン数)をレスポンスから取得。取得できないproviderは文字数/4で概算し `estimated: true`
- リトライ: 429/5xx のみ最大2回、指数バックオフ。`AbortSignal` を尊重
- 呼び出しごとに原価ログレコードを組み立てて返す(KV書き込み自体はP1で実装する`logCost`に委ねるため、この段階では戻り値に含めるだけでよい)

### 4. ルート

- `GET /api/health` → `{ ok: true, version }`
- `POST /api/dev/ping-model` → body `{ role }` を受け、該当モデルに「pong とだけ返せ」を送り疎通確認。**このルートは `ENVIRONMENT !== "production"` のときのみ有効**
- CORS: 開発は `http://localhost:5173`、本番オリジンは環境変数 `ALLOWED_ORIGIN` で指定

### 5. テスト (Vitest)

- `callModel` の各provider形式変換 (fetchをモック)
- maxTokensがリクエストに含まれること
- リトライ挙動 (429→成功)
- AbortSignalで中断されること

## 受け入れ条件

- [ ] `npm run dev` でローカル起動し、`curl /api/health` が返る
- [ ] `.dev.vars` にキーを入れると `POST /api/dev/ping-model` で実モデル疎通が確認できる(手元確認手順をREADME的にworkers/README.mdへ)
- [ ] `git grep -iE "(sk-|api[_-]?key\s*=)"` でシークレット実値がヒットしない
- [ ] モデル変更が `models.ts` の1行編集だけで完結する
- [ ] Vitest 全緑

## やらないこと

ノード並列 / 統合 / KV書き込み / SSE / フロント — すべてP1以降。

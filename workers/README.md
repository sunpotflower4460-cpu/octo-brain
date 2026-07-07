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
# => {"ok":true,"version":"0.0.0-p0"}
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

### テスト

```bash
npm test        # Vitest (外部APIはモック)
npm run typecheck
```

## シークレット運用

- **本番**: `wrangler secret put DEEPSEEK_API_KEY` (等、`.dev.vars.example` のキー名)
- **開発**: `workers/.dev.vars` に記載 (コミット禁止)
- キーの実値をリポジトリに書かない。`git grep` で検出されない状態を保つ。

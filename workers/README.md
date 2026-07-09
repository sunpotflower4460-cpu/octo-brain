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
# => {"ok":true,"version":"0.0.0-p1.5"}
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

### 分析 (analyze) — P1 / P1.5(八芒星・深化)

`.dev.vars` にキーを入れ、`models.ts` の `model` / `baseURL` を実値に設定してから、
curl一発で「Router(ドメイン) → 並列レンズ → 掘る統合 → 検証」を通った一括JSONが返る:

```bash
# deep(有料相当・4軸8腕・掘る統合)
curl -X POST http://localhost:8787/api/analyze \
  -H 'content-type: application/json' \
  -d '{"input":"転職すべきか迷っている","clientId":"dev-uuid-1234","plan":"deep"}'
```

リクエスト:

```jsonc
{
  "input": "string (必須, 4000字以内)",
  "summary": "string (任意, 500字以内。前回返ってきた meta.summary を渡す)",
  "plan": "light | deep (任意, 既定 light)",   // light=2軸4腕 / deep=4軸8腕 (P1.5 §6)
  "clientId": "string (必須, フロント生成のUUID)"
}
```

レスポンス (200):

```jsonc
{
  "answer": "引用から始まり、緊張を言語化し、最後に問いを置く『掘った』回答",
  "summary": "更新版ローリング要約 (次回 summary に渡す)",
  "nodes": [ { "id": "truth", "status": "ok",
              "opinions": [ { "claim": "...", "weight": 0.8, "why": "..." } ] } ],
  "meta": {
    "plan": "deep", "domain": "work", "quorum": "8/8", "fallback": false,
    "tension": { "axis": "心の軸", "reason": "..." } ,   // 最緊張軸。欠落時は null
    "resonance": { "a": {"lens":"risk","claim":"..."},   // 共鳴。欠落時は null (P1.6)
                   "b": {"lens":"values","claim":"..."}, "root": "共通の根" },
    "verified": "pass", "totalCost": 0.0031, "ms": 4200, "quotaUsed": 3
  }
}
```

- `plan` で起動レンズが決まる。`light` は Router が判定したドメイン(love/work/money/family/self/general)
  に応じて2軸4腕、`deep` は全8腕(§4.3 の軸マッピング)。省略時は `light`(安全側)。
- ノード出力は **opinions 形式**(`points` から移行, §4.1)。各 claim/why は60字以内、weight は0〜1。
- `meta.tension` に統合脳が検出した最緊張軸が入る(`---TENSION---` から抽出)。欠落時は `null`(深化ボタン非表示)。
- `meta.resonance` に軸をまたいで響き合う2意見の組が入る(`---RESONANCE---` から抽出, P1.6)。欠落時は `null`。
  マーカー順は 本文 → RESONANCE(任意) → TENSION → SUMMARY。いずれもストリーム・一括の両方で本文に漏れない。
- クォーラム未達時は `meta.fallback: true`(統合脳の単発回答。TENSIONは出ない)。
- 原価ログ (`cost:{yyyymmdd}:{requestId}`) とクォータ (`quota:{clientId}:{yyyymm}`) が KV に書かれる。
- KV書き込み等の部分失敗は `meta.warnings` に載せて可視化する(握りつぶさない)。

### 深化 (deepen) — P1.5(腕間結合)

`POST /api/deepen`。最緊張軸の対角2腕に互いの意見を渡して再考させ、中央脳が織り直す。

```bash
curl -X POST http://localhost:8787/api/deepen \
  -H 'content-type: application/json' \
  -d '{"input":"転職すべきか","summary":"","priorAnswer":"<前回のanswer>",
       "tension":{"axis":"心の軸"},"clientId":"dev-uuid-1234"}'
# => { "answer": "一段深く織り直した回答",
#      "meta": { "axis":"心の軸", "calls":5, "totalCost":0.0021, "ms":3200 } }
```

- `tension.axis` は analyze の `meta.tension.axis` をそのまま渡す。既知の軸(時/心/動/魂)に
  解決できないと **400 `unknown_or_missing_tension`**(深化ボタンのガード)。
- 対角2腕の再考(2コール・Flash)+ 中央脳の織り直し(1コール)。原価は KV に記録。

### 共鳴 (resonate) — P1.6(掛け算)

`POST /api/resonate`。一見遠い2つの意見を掛け合わせ、第三の選択肢を生む(bisociation)。
**AIが提案したペア(`meta.resonance`)でも、ユーザーが自分で選んだ2つの opinion でも同じ形で受ける。**

```bash
curl -X POST http://localhost:8787/api/resonate \
  -H 'content-type: application/json' \
  -d '{"input":"転職すべきか","summary":"","priorAnswer":"<前回のanswer>",
       "resonance":{"a":{"lens":"risk","claim":"引き返せない時期"},
                    "b":{"lens":"values","claim":"自律を大切に"}},
       "clientId":"dev-uuid-1234"}'
# => { "answer": "2つを掛け合わせた第三の選択肢",
#      "meta": { "pair": {...}, "calls": 1, "totalCost": 0.0018, "ms": 2600 } }
```

- `lens` は実在する8レンズID(reason/emotion/risk/empathy/future/truth/step/values)。
  不正 lens → 400 `invalid_lens`、a と b が同一 lens → 400 `same_lens`、claim 120字超 → 400 `claim_too_long`。
- 1コール(synth=Pro, max_tokens 800)。原価は KV に記録。

### 分析 (ストリーミング) — P2

`POST /api/analyze/stream`(リクエストボディは `/api/analyze` と同じ)。
`text/event-stream` で SSE イベントを逐次送出する:

```
event: phase   data: {"phase":"routing"|"nodes"|"synth"|"verify"}
event: node    data: {"id":"truth","status":"ok","opinions":[{"claim":"...","weight":0.8,"why":"..."}]}
event: token   data: {"t":"..."}
event: done    data: { answer, summary, nodes, meta }   // 一括JSONと同形 (meta に plan/domain/tension/resonance)
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

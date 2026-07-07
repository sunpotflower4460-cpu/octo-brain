# 00 — OctoBrain 全体設計

このドキュメントが設計の**唯一の正**。フェーズ指示書と食い違ったらここが優先。

## 1. データフロー

```
POST /api/analyze { input, summary?, mode? }
  │
  ├─① Router ──── 超軽量モデルで simple / normal / complex を分類 (max_tokens: 10)
  │               失敗時は normal にフォールバック
  │
  ├─② Nodes ───── 分類に応じた動詞ノードを並列実行
  │               Promise.allSettled + AbortController(8秒) + クォーラム判定
  │               各ノード: JSON出力固定, max_tokens: 250
  │
  ├─③ Synthesizer─ 統合脳。手続き化プロンプトで合成 (max_tokens: 1200)
  │               P2以降はここをSSEストリーミング
  │
  ├─④ Verifier ── 矛盾・過剰断定・安全の3チェック。表面修正のみ (max_tokens: 500)
  │               問題なければ "pass" でそのまま通す
  │
  └─ KV書き込み ── 原価ログ + クォータ消費
```

## 2. 8動詞ノード定義表 (唯一の対応表)

| id | 内部プロンプトの動詞 | UI表示名 | 絵文字 |
|---|---|---|---|
| `assumptions` | 入力に含まれる暗黙の前提を抽出する | 論理 | 🧠 |
| `counter` | 最も強い反例・反論を1つ構成する | 批判 | ⚡ |
| `gaps` | 判断に欠けている情報を列挙する | 探索 | 🔍 |
| `options` | 進め方を性質の異なる3つの選択肢に分岐する | 創造 | ✨ |
| `worst` | 最悪シナリオとその発生条件を見積もる | リスク | 🛡️ |
| `next` | 具体的な次の一手を1つに絞って提案する | 実行 | 🎯 |
| `compress` | 入力の本質を3行以内に圧縮する | 要約 | 📝 |
| `overclaim` | 入力や前提の中の断定しすぎ・根拠不足を検出する | 慎重 | ⚖️ |

- 内部プロンプトは動詞ベース。「あなたは論理的な人格です」のような人格付与は**しない**
- UI表示名はフロントエンドの見せ方のみに使う。バックエンドのプロンプトに混入させない

### ノード共通システムプロンプト (固定・キャッシュ前提)

```
あなたはOctoBrainの分析ノードです。与えられたタスクだけを実行してください。
- 出力は指定のJSONのみ。前置き・後書き・コードフェンス禁止
- 各pointは60字以内。最大3つ
- わからない場合は points を空にし flag に "insufficient_input" を設定
```

これに各ノードの動詞タスク1行を足す。システムプロンプトは全リクエストで完全固定
(プロンプトキャッシュを効かせるため。ユーザー入力はuserメッセージ側にのみ入れる)。

### ノード出力スキーマ (全ノード共通)

```json
{
  "points": ["...", "..."],
  "confidence": 0.7,
  "flag": null
}
```

- `points`: 1〜3個、各60字以内
- `confidence`: 0.0〜1.0 の自己評価
- `flag`: `null` | `"insufficient_input"` | `"off_topic"`
- パース失敗時の扱い: 応答文字列から `{...}` 部分の抽出を1回試行 → 失敗したらそのノードは `status: "parse_error"` として棄却(リトライしない。クォーラムで吸収する)

## 3. ルーティング (動的起動)

| 分類 | 起動ノード | クォーラム(最低成功数) |
|---|---|---|
| `simple` | compress, next (2基) | 2 |
| `normal` | assumptions, counter, options, next (4基) | 3 |
| `complex` | 全8基 | 5 |

- 分類器プロンプト: 「次の入力への回答に必要な思考の重さを simple / normal / complex のいずれか1語のみで答えよ」
- リクエストで `mode` 明示指定があればRouterをスキップ (プレミアム機能「常時8基」への布石)
- **クォーラム未達時のフォールバック**: 統合をスキップし、Synthesizerモデル単発で直接回答。`meta.fallback: true` を立てる

## 4. Synthesizer (統合脳)

システムプロンプトに以下の手続きを固定で埋め込む:

```
8つ以下の分析ノードからのJSONレポートを統合し、最終回答を生成せよ。手順:
1. ノード間で対立する主張を特定する
2. confidence < 0.4 のレポートは参考情報に格下げする
3. flagが立っているレポート・pointsが空のレポートは除外する
4. 残りを統合する。対立点が残る場合は隠さず「見方が分かれる点」として明示する
5. 出力構成: 結論 → 根拠(ノードの知見を溶かし込む) → 見方が分かれる点(あれば) → 次の一手
- ノードのIDや「ノード3によると」のような機械的引用はしない。自然な文章に溶かす
- 過剰な断定を避け、根拠の強さに応じた言い方をする
```

user側には `[会話要約(あれば)] + [今回の入力] + [ノードレポートJSON配列]` を渡す。

## 5. Verifier (最終検証)

- 入力: Synthesizerの出力全文
- チェック: (a)内部矛盾 (b)過剰断定 (c)安全上の問題
- **中身を変えない。表面のみ最小修正**。問題なければ文字列 `"pass"` のみを返し、元の出力をそのまま使う
- 修正した場合は `meta.verified: "modified"` を記録

## 6. コスト設計

| 呼び出し | max_tokens | 備考 |
|---|---|---|
| Router | 10 | 1語のみ |
| Node ×N | 250 | JSON実測は100前後 |
| Synthesizer | 1200 | ここだけ予算を使う |
| Verifier | 500 | passなら数トークン |

- **入力複製の回避**: 会話履歴の全文を渡さない。クライアントが保持する「ローリング要約」(300字以内、Synthesizerが `meta.summary` として毎回更新版を返す)+今回の入力のみを各ノードに渡す
- システムプロンプト完全固定でプロンプトキャッシュを効かせる
- max_tokensは必ずAPIパラメータで指定(プロンプト内の「短く」というお願いだけにしない)

## 7. モデル設定の抽象化

`workers/src/config/models.ts` に一元化:

```ts
export type ModelRole = "router" | "node" | "synth" | "verifier";

export interface ModelConfig {
  provider: "openai-compat" | "gemini" | "anthropic";
  baseURL?: string;        // openai-compat のとき必須 (DeepSeek/Mistral/OpenAI等を切替)
  model: string;           // ← 実装時に最新価格を確認して設定。ドキュメントには書かない
  maxTokens: number;
  keyEnv: string;          // 参照する環境変数名 (例: "DEEPSEEK_API_KEY")
}

export const MODELS: Record<ModelRole, ModelConfig> = { ... };

// 任意: ノード多様化。node役割に複数モデルを配列で持たせ、
// ノードindexで振り分けると出力相関がさらに下がる
export const NODE_MODEL_POOL: ModelConfig[] = [ ... ];
```

`callModel(role, messages, opts)` がこの設定を読み、原価ログを書いてから結果を返す。
**全モデル呼び出しはこの関数を経由する**(直接fetch禁止)。

## 8. KVスキーマ

| key | value | TTL |
|---|---|---|
| `quota:{clientId}:{yyyymm}` | 使用回数 (数値) | 62日 |
| `cost:{yyyymmdd}:{requestId}` | `{ calls: [{role, model, inTok, outTok, estCost, ms}], totalCost, quorum, fallback }` | 90日 |

- `clientId` は当面フロント生成のUUID(認証は後続フェーズ)
- 単価テーブルは `models.ts` に `pricePerMTokIn/Out` として持ち、estCostを計算

## 9. API契約

### P1完了時 (一括JSON)

```
POST /api/analyze
{ "input": string, "summary"?: string, "mode"?: "auto"|"simple"|"normal"|"complex", "clientId": string }

200:
{
  "answer": string,
  "summary": string,            // 更新版ローリング要約 (クライアントが次回渡す)
  "nodes": [ { "id": "counter", "status": "ok"|"timeout"|"parse_error"|"skipped",
               "points": [...], "confidence": 0.8 } ],
  "meta": { "route": "complex", "quorum": "6/8", "fallback": false,
            "verified": "pass"|"modified", "totalCost": 0.0031, "ms": 4200 }
}
```

### P2で追加 (SSE)

```
POST /api/analyze/stream   (同じリクエストボディ)

event: phase   data: {"phase":"routing"|"nodes"|"synth"|"verify"}
event: node    data: {"id":"counter","status":"ok","points":[...],"confidence":0.8}
event: token   data: {"t":"..."}
event: done    data: { answer, summary, nodes, meta }   // 一括JSONと同形
event: error   data: {"message":"..."}
```

フロントの `appState` 対応: `nodes`フェーズ → `processing_subs`、`synth`以降 → `processing_main`。

## 10. スコープ外

認証 / IAP課金 / レート制限の本格実装(当面は月間クォータのみ) / Capacitorネイティブビルド / 多言語対応

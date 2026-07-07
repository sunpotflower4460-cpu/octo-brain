# CLAUDE.md — octo-brain 運用ルール

## プロジェクト概要

OctoBrain: 8つの軽量LLMノード(並列)+ 統合脳 + 検証で「安いのに深い」を実現する分析AI。
全体設計は `docs/00_architecture.md`。作業は `docs/phases/` の指示書単位で進める。

## 進め方

- **1コミット(1PR) = 1フェーズ = 1目的**。指示書のスコープ外に手を出さない
- 各フェーズの「受け入れ条件」をすべて満たしてから完了報告する
- 指示書間に矛盾や不明点を見つけたら、勝手に解釈して進めず**質問する**
- 完了報告には「受け入れ条件チェックリストの結果」と「変更ファイル一覧」を含める

## 絶対ルール

1. **APIキー・シークレットをコードやリポジトリに書かない**
   - 本番: `wrangler secret put <KEY_NAME>`
   - 開発: `workers/.dev.vars` (必ず `.gitignore` に含める)
2. **モデルIDをロジック内にハードコードしない**
   - `workers/src/config/models.ts` のみで管理。他のファイルにモデル名の文字列を書かない
3. **ノードの内部プロンプト(動詞)とUI表示名(視点の世界観)を混ぜない**
   - 内部: 「入力に含まれる前提を抽出せよ」 / UI: 「論理」
   - この分離は `docs/00_architecture.md` のノード定義表が唯一の対応表
4. **`docs/reference/prototype.jsx` の OctopusCanvas は移植時に描画ロジックの挙動を変えない**
   - propsインターフェース (`appState`) も維持する
5. **原価ログを通らないモデル呼び出しを作らない**
   - すべてのLLM呼び出しは `callModel()` 抽象化レイヤーを経由し、トークン数とコストが記録される

## 技術規約

- TypeScript strict モード。`any` は原則禁止
- テスト: Vitest。外部APIは必ずモック。コアロジック(クォーラム判定・統合入力の構築・ルーター分類・JSONパース失敗の扱い)はテスト必須
- バックエンド: Cloudflare Workers + Hono
- フロントエンド: React + TypeScript + Vite (Capacitor互換の構成を維持: 相対パス、環境変数は `VITE_` プレフィックス)
- エラーは握りつぶさない。部分成功(ノード欠落など)は必ずレスポンスの `meta` に含めて可視化する
- コメント・ドキュメントは日本語でよい。コード識別子は英語

## 動作確認コマンド

```bash
# バックエンド (workers/)
npm run dev        # ローカル起動 (wrangler dev)
npm test           # Vitest
npm run deploy     # Cloudflare へデプロイ

# フロントエンド (web/)
npm run dev        # Vite dev server
npm run build      # 本番ビルド
```

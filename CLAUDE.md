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
4. **Living Core は「思考の計器」として意味を保持する(P2.7 で凍結ルールを撤廃)**
   - 守るのはコードではなく体験の意味: 中央の1つのCore、8レンズ=8腕の対応、4対角軸、
     nodes時の並列探索、synth時の中央への収束、深化=対角2本の張り合い、共鳴=離れた2本の同期、
     未起動/作業中/完了/失敗の識別。
   - 現行 `OctopusCanvas` の数式・見た目・props・レンダラー・ファイル構成を保持する義務はない。
     Canvas 2D / SVG / DOM / WebGL / ハイブリッドから最適案を選び全面再設計してよい。
     アクセシビリティ・モバイル性能・情報理解を装飾より優先する。
   - 8レンズの順序・UI名・絵文字・軸は `web/src/config/nodeDisplay.ts`(表側)と
     `docs/01_depth_design.md` の定義表を唯一の正とする。
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

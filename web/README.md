# octo-brain / web

React + TypeScript + Vite フロントエンド。雛形のタコUI(`docs/reference/prototype.jsx`)を
移植し、バックエンド(`workers/`)と SSE で接続する。全体設計は
[`../docs/00_architecture.md`](../docs/00_architecture.md) §9。P2 のスコープ。

## セットアップ

```bash
cd web
npm install
cp .env.example .env       # VITE_API_BASE を必要に応じて調整 (既定 http://localhost:8787)
```

## 開発

バックエンドとフロントを別ターミナルで起動する:

```bash
# ターミナル1: バックエンド
cd workers && npm run dev        # http://localhost:8787 (要 .dev.vars のキー)

# ターミナル2: フロント
cd web && npm run dev            # http://localhost:5173
```

ブラウザで http://localhost:5173 を開くと会話できる。統合脳の回答が逐次
ストリーム表示され、各返信の下の「8つの視点を見る」でノード別カードが開く。

## Capacitor互換

- `vite.config.ts` は `base: './'`(相対パス)。
- 環境変数は `VITE_` プレフィックスのみ(`VITE_API_BASE`)。
- 会話の永続化・ネイティブビルドは後続フェーズ(スコープ外)。

## コマンド

```bash
npm run dev         # Vite dev server
npm run build       # 本番ビルド (tsc --noEmit + vite build)
npm test            # Vitest (SSEパーサ / phase→appState 写像)
npm run typecheck   # tsc --noEmit
```

## 構成メモ

- `src/components/OctopusCanvas.tsx` — 雛形からの移植。既存の `appState` 描画ロジックは不変(絶対ルール4)。P1.5(P2拡張)で **深化中に対角2本の腕だけが光る**演出を、任意 prop `deepenArms?: number[] | null` として**追加**(null時は移植元と完全同一の挙動)。
- `src/lib/sse.ts` — fetch ストリームの SSE パーサ(EventSource は POST 非対応のため自前実装)。
- `src/lib/phase.ts` — SSE `phase` → `appState` 写像。
- `src/lib/api.ts` — `/api/analyze/stream` クライアント + `deepen()`(`/api/deepen`)。
- `src/config/nodeDisplay.ts` — 8レンズの UI表示名+絵文字+軸(視点の世界観)。`armsForAxis()` で軸ラベル→対角2腕の番号を引く。バックエンドの内部プロンプトとは分離。

## P1.5(深化)対応

- ノード出力は **opinions 形式**(`{claim,weight,why}`)を表示。
- `plan` トグル(ライト 2軸4腕 / ディープ 4軸8腕)で起動レンズ数を選ぶ。
- 回答に緊張軸がある場合(`meta.tension`)は「この回答は◯◯の軸が張っています」を表示し、
  **「この緊張を深く掘る」**ボタンで `/api/deepen` を呼ぶ。深化中はタコの**対角2本の腕だけが光り**、
  結果は「🐙 深掘り」ブロックに表示される。`meta.tension` が null のときボタンは出さない。

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

- `src/components/OctopusCanvas.tsx` — 雛形からの移植。描画ロジックは変更していない(絶対ルール4)。propsは `appState: 'idle' | 'processing_subs' | 'processing_main'`。
- `src/lib/sse.ts` — fetch ストリームの SSE パーサ(EventSource は POST 非対応のため自前実装)。
- `src/lib/phase.ts` — SSE `phase` → `appState` 写像。
- `src/lib/api.ts` — `/api/analyze/stream` クライアント。
- `src/config/nodeDisplay.ts` — ノードの UI表示名+絵文字(視点の世界観)。バックエンドの内部プロンプトとは分離。

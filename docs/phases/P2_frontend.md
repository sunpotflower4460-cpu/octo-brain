# P2 — フロントエンド・UI移植・ストリーミング

## 目的

`web/` に React + TypeScript + Vite のフロントを建て、雛形のタコUIを移植し、
バックエンドとSSEで接続する。統合脳の回答が**逐次流れて表示される**状態がゴール。

前提: P1完了。参照: `docs/reference/prototype.jsx`(UIの移植元)、`docs/00_architecture.md` §9(SSE契約)。

## 実装内容

### 1. バックエンド: SSEエンドポイント追加 `POST /api/analyze/stream`

- P1のパイプラインを流用し、§9のSSEイベント(`phase` / `node` / `token` / `done` / `error`)を送出
- Workers上では `TransformStream` + `text/event-stream` で実装
- ノードは完了した順に `node` イベントを送る(allSettledの完了を待たずに逐次)
- Synthesizerはprovider APIのストリーミングを使い `token` を逐次送出。`---SUMMARY---` 以降はクライアントに流さずサーバー側で切ってdoneに含める
- Verifierはストリーム完了後に実行。修正があった場合のみ `done` の `answer` を修正版に差し替え(`meta.verified: "modified"`)。ストリーム表示と最終保存文面が変わりうることを許容する設計
- 既存の一括JSON版 `/api/analyze` は残す(ベンチP3で使う)

### 2. フロント初期化

- `web/` に Vite + React + TS。**Capacitor互換**: `base: './'`、環境変数は `VITE_API_BASE` のみ
- Tailwind導入(雛形のクラスをそのまま活かすため)
- lucide-react 導入

### 3. OctopusCanvas移植

- `prototype.jsx` から `src/components/OctopusCanvas.tsx` へ
- **描画ロジックの挙動変更禁止**。propsは `appState: 'idle' | 'processing_subs' | 'processing_main'` を維持
- TypeScript化に伴う型付けのみ許可

### 4. チャットUI移植と拡張

- 雛形のレイアウト・配色・処理中インジケータを踏襲
- 状態管理: SSEの `phase` イベント → `appState` に写像 (§9末尾の対応)
- `token` イベントでアシスタント返信を逐次描画
- **「8つの視点を見る」折りたたみ**: 各アシスタント返信の下に、`node` イベントで届いたノード結果をUI表示名+絵文字(§2の表)のカードで展開表示。confidence をバーか数値で、`timeout`/`parse_error` のノードは暗転表示(隠さない)
- `meta` の表示: 応答下部に小さく `route / quorum / 応答時間`(コストは開発ビルドのみ表示)
- ローリング要約: `done` で受けた `summary` を保持し、次のリクエストで送る(リロードで消えてよい。永続化はスコープ外)
- エラー/フォールバック時のUI: fallbackなら「シンプルモードで応答しました」と小さく表示

### 5. テスト

- SSEパーサ(イベント分割・複数イベント連結・途中切断)のユニットテスト
- phase→appState写像のテスト
- バックエンド側: `---SUMMARY---` 切り出しがストリームでも機能するかのテスト

## 受け入れ条件

- [ ] `web/` で `npm run dev`、`workers/` で `npm run dev` を起動し、ブラウザで実際に会話できる
- [ ] タコが `idle → processing_subs → processing_main → idle` と状態遷移する(雛形と同じ見た目)
- [ ] 統合回答が逐次ストリーム表示される
- [ ] 「8つの視点を見る」でノード別カードが開き、失敗ノードも暗転で見える
- [ ] 2ターン目の会話で `summary` が送られている(NetworkタブまたはログでOK)
- [ ] `npm run build` が通る
- [ ] テスト全緑

## やらないこと

Capacitorネイティブビルド / IAP / 認証 / 会話の永続化 — 後続フェーズ。

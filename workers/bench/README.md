# bench — 20問ベンチ (P3)

同一の20問に対し **OctoBrain**(8ノード統合)と **単発上位モデル** の回答を取得し、
品質・コスト・レイテンシを比較する。結果は [`results.md`](results.md)。

## 使い方

```bash
# 1. モデル/キーを設定
#    - bench/config.ts の BENCH_SINGLE (B: 単発上位) と BENCH_EVAL (評価者) を実値に
#    - 環境変数にキーを渡す (config の keyEnv 名):
#        export BENCH_SINGLE_API_KEY=...
#        export BENCH_EVAL_API_KEY=...
#    - A(OctoBrain) 側は workers dev サーバーの models.ts / .dev.vars を使う

# 2. workers dev を起動 (別ターミナル)
npm run dev            # http://localhost:8787

# 3. ベンチ実行 (実行 → 評価 → results.md 生成を一発で。途中再開可)
npm run bench
```

個別実行も可能: `npm run bench:run` / `npm run bench:eval` / `npm run bench:report`。

## 仕組み

- **A (OctoBrain)**: `POST /api/analyze` を `mode: "complex"`(最大構成)で叩く。
- **B (単発上位)**: `callModel` を `BENCH_SINGLE` で直接呼ぶ。
- **評価**: A・Bどちらにも使っていない `BENCH_EVAL` で**ブラインド相対採点**。
  提示順は問ごとに固定シード(`BLIND_SEED`)でランダム化し、ログと `eval_*.json` に記録。
  ルーブリック(各1〜5): 深さ / 多角性 / 実用性 / 正確さ / 簡潔さ。
- **境界問題 (19, 20)**: 数学・最新情報の限界を正直に認めるかを併記(負けてよい問題)。
- 生データ `bench/raw/` は `.gitignore`(既存はスキップ=途中再開可)。`results.md` はコミットする。

## モック実行 (キー無しでハーネス検証)

```bash
BENCH_MOCK=1 npm run bench     # 実APIを叩かず決定論ダミーで全工程を通し results.md を生成
```

現在コミットされている `results.md` はこのモックランで生成したサンプル(冒頭に明記)。
実データはキー設定後に `npm run bench` で再生成する。

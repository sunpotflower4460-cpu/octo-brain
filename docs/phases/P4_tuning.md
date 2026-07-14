# P4 — チューニング(サブセット実装 + ハンドオフ)

> ロードマップ `docs/ROADMAP.md` の P4 節のうち、**実 API キー・実機・人の判断を必要としない部分**を
> この環境で実装・検証する。キー/人が要る部分は「ハンドオフ」として明記して残す。

## この PR で実装する(キー不要・検証可能)

1. **境界の正直さ**(`workers/src/lib/boundary.ts`)
   - 入力を LLM なしで軽く走査し、モデルが不得手な領域を検出:
     - `math`: 算術式・平方根・方程式・「計算して」等
     - `recency`: 最新/リアルタイム/株価・為替・ニュース・天気 等
   - 検出したら回答**冒頭**に正直な但し書きを前置き(analyze / analyzeStream 両方)。`meta.boundary` にも載せる
   - 誤爆を避けるためパターンは保守的。取りこぼしより「余計な但し書き」を避ける

2. **ルーブリックに「刺さり(specificity)」を追加**(`workers/bench/`)
   - `RUBRIC_KEYS` に `specificity` を追加。評価プロンプトの項目リスト・定義・JSONテンプレートは
     `RUBRIC_KEYS` から生成するよう変更(項目追加時のズレを防止)
   - report / mock も RUBRIC_KEYS 駆動で自動対応。`npm run bench`(MOCK)で results.md に「刺さり」行が出る

3. **NODE_MODEL_POOL の構造整備**(`workers/src/config/models.ts`)
   - 多社軽量モデルで出力相関を下げる仕組み(`pickNodeModel`)は既存。P4 の意図と設定例(SET_ME)を明記
   - 実値は実測後に確定するためプールは空のまま(挙動不変)

4. **料金設計メモの下書き**(`docs/pricing_notes.md`)
   - 1回答原価の計算式・プラン別・損益分岐・Pro 下限の観点。数値は `<実測>` プレースホルダー
   - 実測は `npm run ops:report`(P5)で回収する枠組みにする

## ハンドオフ(実キー環境 + うえきさんの判断が必要 → 後続)

- **モデル最終選定**: 本番ベンチ(`npm run bench`、MOCK 無し)を回して `bench/results.md` を読み、
  `models.ts` の `SET_ME` を実測に基づき確定(最新価格を再確認)
- **NODE_MODEL_POOL の実設定**と再ベンチ(多角性スコアの変化を確認)
- **キャッシュヒット率の実測**(DeepSeek `prompt_cache_hit_tokens`)
- **深化・共鳴の使用率と追加原価の実測**(`ops:report` の kind 内訳)
- **胸テスト**(`01_depth_design.md §9`): 本物の悩みを投げ、刺さるかを**自分の胸で**判定。深さの最終検証者は評価モデルではない
- **弱かったカテゴリのプロンプト改良**(1変更→再ベンチのループ。`questions.json` は変えない)
- 料金設計メモの数値確定

## 受け入れ条件(この PR)

- [ ] boundary: math/recency を検出し回答冒頭に但し書き、`meta.boundary` に反映。誤爆しにくい
- [ ] boundary のユニットテスト(hit/miss)が緑
- [ ] bench に specificity が加わり、MOCK で results.md に「刺さり」が出る
- [ ] `NODE_MODEL_POOL` の設定例・意図が明記(値は handoff)
- [ ] `docs/pricing_notes.md`(下書き)がある
- [ ] `tsc` / vitest(workers)緑・web ビルド成功

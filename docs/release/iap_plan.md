# 課金設計(P8)— App 内課金(IAP)runbook

> Apple 3.1.1(デジタル機能は IAP 必須)準拠。**プラン設計・products・サンドボックス検証は手動**。
> サーバー側のクォータ防御(P5)は実装済みで、そのまま第一防壁に使える。

## プラン設計(下書き。価格は P4 の実測原価で確定)

| プラン | 内容 | 根拠 |
|---|---|---|
| Free | 月 N 回(`FREE_MONTHLY_QUOTA`=現状100)+ **plan:"light" 固定**(2軸4腕+Flash統合) | 原価が最小。まず無料で価値体験(4.2/審査対策) |
| Pro(月額サブスク) | plan:"deep"(8腕+Pro統合)+ **深化・共鳴**(プレミアムの象徴)+ 回数大幅増 | `docs/pricing_notes.md` の実測でサブスク下限を決定 |

- 方針は「サブスク下限は安く」。480円台は Apple 手数料後ギリギリ → 深化/共鳴の使用率実測(P4)で最終決定
- 任意: リワード動画広告で無料枠を補助(非強制)。導入時は App Privacy/ATT を更新

## 実装方針(RevenueCat)

1. `@revenuecat/purchases-capacitor` を導入(P7 で ios/ 生成後)
2. App Store Connect で products 作成(サブスク: `pro_monthly` 等)、RevenueCat に接続
3. アプリ: ペイウォールUI・購入・**購入復元**・解約導線。未課金でも完結する導線を必ず残す
4. **サーバー側のプラン検証は段階設計**:
   - 第一段階: クライアントがエンタイトルメントを申告 → サーバーは**クォータで防御**(不正しても回数上限まで。P5 実装済み)
   - 第二段階(ユーザー増後): RevenueCat API でサーバー検証

## サーバー連携メモ

- Free/Pro の別は `plan`(light/deep)で表現済み。Pro のみ deep + deepen/resonate を UI で解放する
- クォータ上限は `FREE_MONTHLY_QUOTA`。Pro は上限を引き上げる(clientId 単位のまま、プラン別上限は将来 KV or DO で)
- 原価と使用率は `npm run ops:report`(kind 内訳)で継続監視

## 完了の目安

サンドボックスで 購入 → Pro 機能解放 → 復元 まで通る / 未課金でもアプリが完結して使える。

## この環境で未実装の理由

products・価格・サンドボックス・RevenueCat 接続はすべて App Store Connect と実機が前提のため、
ここでは設計と段階方針のみ。価格は `docs/pricing_notes.md` の実測確定後に置く。

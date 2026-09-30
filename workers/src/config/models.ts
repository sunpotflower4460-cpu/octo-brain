// ============================================================================
// モデル設定の一元管理。
//
// 【実装者へ】モデル/価格の変更時は公式の最新価格を確認し、
//   単価 (`pricePerMTokIn` / `pricePerMTokOut`, いずれも USD / 100万トークン) も
//   同時に併記してください。ドキュメントには価格を書かず、この1ファイルのみで管理します。
//
// モデルの差し替えはこのファイルの1行編集で完結させること
// (他のファイルにモデル名の文字列を書かない — CLAUDE.md 絶対ルール2)。
// ============================================================================

export type ModelRole = "router" | "node" | "synth" | "verifier";

export type ModelProvider = "openai-compat" | "gemini" | "anthropic";

export interface ModelConfig {
  provider: ModelProvider;
  baseURL?: string; // openai-compat のとき必須 (DeepSeek/Mistral/OpenAI等を切替)
  model: string; // ← 実装時に最新価格を確認して設定。ドキュメントには書かない
  maxTokens: number;
  keyEnv: string; // 参照する環境変数名 (例: "DEEPSEEK_API_KEY")
  pricePerMTokIn: number; // USD / 100万入力トークン
  pricePerMTokOut: number; // USD / 100万出力トークン
  // openai-compat のリクエストボディに追加する provider 固有パラメータ
  // (例: DeepSeek の思考モード無効化 { thinking: { type: "disabled" } })。
  // model / messages / max_tokens / stream は上書きできない(抽象化レイヤー側が優先)。
  extraBody?: Record<string, unknown>;
}

// DeepSeek(OpenAI互換)。価格は公式 https://api-docs.deepseek.com/quick_start/pricing の
// ピーク時単価(キャッシュミス入力 / 出力)で見積もる=原価ログは安全側(オフピークは約半額)。
// 思考モードは既定 ON のため全役割で無効化する(ON のままだと推論トークンで max_tokens を
// 使い切り、ルーター10トークン・ノードJSONが空/壊れになる)。
const DEEPSEEK_BASE = "https://api.deepseek.com";
const NO_THINKING = { thinking: { type: "disabled" } };

const FLASH = {
  provider: "openai-compat",
  baseURL: DEEPSEEK_BASE,
  model: "deepseek-flash",
  keyEnv: "DEEPSEEK_API_KEY",
  pricePerMTokIn: 0.3,
  pricePerMTokOut: 1.2,
  extraBody: NO_THINKING,
} as const satisfies Omit<ModelConfig, "maxTokens">;

const PRO = {
  provider: "openai-compat",
  baseURL: DEEPSEEK_BASE,
  model: "deepseek-v4-pro",
  keyEnv: "DEEPSEEK_API_KEY",
  pricePerMTokIn: 1.32,
  pricePerMTokOut: 3.96,
  extraBody: NO_THINKING,
} as const satisfies Omit<ModelConfig, "maxTokens">;

// 役割ごとの既定モデル。docs/00_architecture.md §6 の max_tokens 設計に合わせる。
// 天井は統合脳が決める(README 原則2)ため synth だけ上位モデル、他は軽量モデル。
export const MODELS: Record<ModelRole, ModelConfig> = {
  router: { ...FLASH, maxTokens: 10 },
  node: { ...FLASH, maxTokens: 250 },
  // 日本語はほぼ1字≒1トークン。本文700字目安+機械可読ブロックが切れない余裕を持たせる
  synth: { ...PRO, maxTokens: 2000 },
  // 修正時は回答全文を出し直すため synth と同じ上限(通常は "pass" のみで安い)
  verifier: { ...FLASH, maxTokens: 2000 },
};

// ノード多様化プール (P4)。node役割に複数社の軽量モデルを持たせ、pickNodeModel が
// ノードindexで振り分ける。異なる学習分布のモデルを混ぜると出力の相関が下がり、
// 8視点の「多角性」が上がる (MoA研究の知見)。
//
// 【P4 実測後に確定する / この環境では未設定】
//   実キー・実価格が要るためプールは空のまま(空なら MODELS.node のみを使う=挙動不変)。
//   実測(bench の多角性スコア変化)を見て 2〜3 社を選び、下の例のように設定する:
//
//   export const NODE_MODEL_POOL: ModelConfig[] = [
//     { provider: "openai-compat", baseURL: "SET_ME_A", model: "SET_ME_A", maxTokens: 250,
//       keyEnv: "NODE_A_API_KEY", pricePerMTokIn: 0, pricePerMTokOut: 0 },
//     { provider: "openai-compat", baseURL: "SET_ME_B", model: "SET_ME_B", maxTokens: 250,
//       keyEnv: "NODE_B_API_KEY", pricePerMTokIn: 0, pricePerMTokOut: 0 },
//     { provider: "gemini", model: "SET_ME_C", maxTokens: 250,
//       keyEnv: "GEMINI_API_KEY", pricePerMTokIn: 0, pricePerMTokOut: 0 },
//   ];
//   ※ 各社の keyEnv は wrangler secret / .dev.vars で個別に設定(リポジトリに書かない)。
//   ※ 弱いモデルを混ぜると総合が下がることがある(MoA知見)。1社追加→再ベンチのループで確認。
export const NODE_MODEL_POOL: ModelConfig[] = [];

// index に応じて node 用モデルを選ぶ。プールが空なら既定の node モデル。
export function pickNodeModel(index: number): ModelConfig {
  if (NODE_MODEL_POOL.length === 0) return MODELS.node;
  return NODE_MODEL_POOL[index % NODE_MODEL_POOL.length];
}

// USD 概算コスト。トークン数と単価から算出。
export function estimateCost(
  cfg: ModelConfig,
  inTok: number,
  outTok: number,
): number {
  return (
    (inTok / 1_000_000) * cfg.pricePerMTokIn +
    (outTok / 1_000_000) * cfg.pricePerMTokOut
  );
}

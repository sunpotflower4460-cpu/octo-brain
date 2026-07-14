// ============================================================================
// モデル設定の一元管理。
//
// 【実装者へ】各エントリの `model` は "SET_ME" のプレースホルダーです。
//   実装時に最新のモデル/価格を確認して設定してください。
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
}

// 役割ごとの既定モデル。docs/00_architecture.md §6 の max_tokens 設計に合わせる。
export const MODELS: Record<ModelRole, ModelConfig> = {
  router: {
    provider: "openai-compat",
    baseURL: "SET_ME", // 例: "https://api.deepseek.com/v1"
    model: "SET_ME",
    maxTokens: 10,
    keyEnv: "DEEPSEEK_API_KEY",
    pricePerMTokIn: 0,
    pricePerMTokOut: 0,
  },
  node: {
    provider: "openai-compat",
    baseURL: "SET_ME",
    model: "SET_ME",
    maxTokens: 250,
    keyEnv: "DEEPSEEK_API_KEY",
    pricePerMTokIn: 0,
    pricePerMTokOut: 0,
  },
  synth: {
    provider: "openai-compat",
    baseURL: "SET_ME",
    model: "SET_ME",
    maxTokens: 1200,
    keyEnv: "DEEPSEEK_API_KEY",
    pricePerMTokIn: 0,
    pricePerMTokOut: 0,
  },
  verifier: {
    provider: "openai-compat",
    baseURL: "SET_ME",
    model: "SET_ME",
    maxTokens: 500,
    keyEnv: "DEEPSEEK_API_KEY",
    pricePerMTokIn: 0,
    pricePerMTokOut: 0,
  },
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

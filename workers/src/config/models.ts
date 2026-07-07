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

// 任意: ノード多様化。node役割に複数モデルを配列で持たせ、
// ノードindexで振り分けると出力相関がさらに下がる (P1以降で利用)。
// 空配列のときは MODELS.node のみを使う。
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

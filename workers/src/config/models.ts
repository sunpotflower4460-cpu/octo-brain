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
  // 出力上限のパラメータ名。OpenAI の推論モデル(GPT-6 系)は max_completion_tokens のみ受け付ける
  maxTokensParam?: "max_tokens" | "max_completion_tokens";
  // 推論トークンの予算。出力上限(maxTokens や呼び出し側の上書き)に必ず上乗せされる。
  // 推論が上限を食って本文が空になるのを防ぐ(共鳴のように上限を上書きする呼び出しでも効く)
  reasoningBudget?: number;
}

export const MODEL_ROLES: ModelRole[] = ["router", "node", "synth", "verifier"];

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

// OpenAI GPT-6 Luna。公式 https://developers.openai.com/api/docs/pricing の標準(short context)単価。
// 推論モデルで既定の推論は medium。推論トークンは出力として課金され max_completion_tokens も
// 食うため、全役割で reasoning_effort="none" にする(役割はどれも「狭い作業」で推論不要)。
const LUNA = {
  provider: "openai-compat",
  baseURL: "https://api.openai.com/v1",
  model: "gpt-6-luna",
  keyEnv: "OPENAI_API_KEY",
  pricePerMTokIn: 0.1,
  pricePerMTokOut: 0.5,
  extraBody: { reasoning_effort: "none" },
  maxTokensParam: "max_completion_tokens",
} as const satisfies Omit<ModelConfig, "maxTokens">;

// 比較評価用(開発環境の /api/dev/baseline だけで使う)。「普通のチャットボット」相当:
// 同じ Luna を推論つき(既定の medium)で1回呼ぶ構成と、上位の GPT-6 Sol。評価者にも Sol を使う。
export const BASELINE_MODELS: Record<"luna" | "sol", ModelConfig> = {
  luna: {
    ...LUNA,
    extraBody: { reasoning_effort: "medium" },
    maxTokens: 2000,
    reasoningBudget: 8000,
  },
  sol: {
    provider: "openai-compat",
    baseURL: "https://api.openai.com/v1",
    model: "gpt-6-sol",
    keyEnv: "OPENAI_API_KEY",
    pricePerMTokIn: 2,
    pricePerMTokOut: 10,
    extraBody: { reasoning_effort: "medium" },
    maxTokensParam: "max_completion_tokens",
    maxTokens: 3000,
    reasoningBudget: 8000,
  },
};

// 役割ごとの max_tokens。docs/00_architecture.md §6 の設計に合わせる。
// synth は日本語ほぼ1字≒1トークンで本文700字目安+機械可読ブロックが切れない余裕、
// verifier は修正時に全文を出し直すため synth と同じ上限(通常は "pass" のみで安い)。
const MAX_TOKENS: Record<ModelRole, number> = {
  router: 10,
  node: 250,
  synth: 2000,
  verifier: 2000,
};

export type ModelProfile = "deepseek" | "luna";

// 構成(プロファイル)。天井は統合脳が決める(README 原則2)。
// - deepseek: 軽量 flash + 統合だけ上位の v4-pro
// - luna: 全役割 GPT-6 Luna(実測トークンで原価は deepseek ピーク比 約1/6)
export const PROFILES: Record<ModelProfile, Record<ModelRole, ModelConfig>> = {
  deepseek: {
    router: { ...FLASH, maxTokens: MAX_TOKENS.router },
    node: { ...FLASH, maxTokens: MAX_TOKENS.node },
    synth: { ...PRO, maxTokens: MAX_TOKENS.synth },
    verifier: { ...FLASH, maxTokens: MAX_TOKENS.verifier },
  },
  luna: {
    router: { ...LUNA, maxTokens: MAX_TOKENS.router },
    node: { ...LUNA, maxTokens: MAX_TOKENS.node },
    synth: { ...LUNA, maxTokens: MAX_TOKENS.synth },
    verifier: { ...LUNA, maxTokens: MAX_TOKENS.verifier },
  },
};

// 使う構成を決める。MODEL_PROFILE(wrangler vars)で明示できる。未指定なら
// OPENAI_API_KEY が登録されていれば luna(安い)、無ければ deepseek。
// キーを登録するだけで切り替わり、外せば元に戻る(コード変更・再デプロイ不要)。
export function activeProfile(env: Record<string, unknown>): ModelProfile {
  const explicit = env.MODEL_PROFILE;
  if (explicit === "deepseek" || explicit === "luna") return explicit;
  const openaiKey = env.OPENAI_API_KEY;
  return typeof openaiKey === "string" && openaiKey.length > 0 ? "luna" : "deepseek";
}

// 混雑(429)や障害(5xx)で主のプロバイダーが応答できないときの切り替え先。
// もう一方の構成の同じ役割を使う(両社の「1分あたりの上限」を合わせて使える)。
// 切り替え先のキーが無い、または MODEL_FALLBACK="off" なら null。
export function fallbackFor(
  role: ModelRole,
  env: Record<string, unknown>,
  primary: ModelConfig,
): ModelConfig | null {
  if (env.MODEL_FALLBACK === "off") return null;
  const other: ModelProfile = primary.keyEnv === PROFILES.luna[role].keyEnv ? "deepseek" : "luna";
  const cfg = PROFILES[other][role];
  const key = env[cfg.keyEnv];
  return typeof key === "string" && key.length > 0 ? cfg : null;
}

// 統合脳(synth)だけ推論をオンにする運用スイッチ(luna 構成のみ)。
// LUNA_SYNTH_REASONING = "none"(既定) | "low" | "medium" | "high"。
// 推論トークンは出力として課金され max_completion_tokens も消費するため、本文分(2000)に
// 推論の予算を足す。ほかの役割は狭い作業なので推論なし(並列8本の遅延と原価を増やさない)。
const SYNTH_REASONING_BUDGET: Record<string, number> = { low: 4000, medium: 8000, high: 16000 };

export function modelFor(role: ModelRole, env: Record<string, unknown>): ModelConfig {
  const profile = activeProfile(env);
  const cfg = PROFILES[profile][role];
  const effort = env.LUNA_SYNTH_REASONING;
  if (profile === "luna" && role === "synth" && typeof effort === "string" && effort in SYNTH_REASONING_BUDGET) {
    return {
      ...cfg,
      extraBody: { reasoning_effort: effort },
      reasoningBudget: SYNTH_REASONING_BUDGET[effort],
    };
  }
  return cfg;
}

// ノード多様化プール (P4)。node役割に複数社の軽量モデルを持たせ、pickNodeModel が
// ノードindexで振り分ける。異なる学習分布のモデルを混ぜると出力の相関が下がり、
// 8視点の「多角性」が上がる (MoA研究の知見)。
//
// 【P4 実測後に確定する / この環境では未設定】
//   実キー・実価格が要るためプールは空のまま(空なら構成の node のみを使う=挙動不変)。
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

// index に応じて node 用モデルを選ぶ。プールが空なら現在の構成の node モデル。
export function pickNodeModel(index: number, env: Record<string, unknown>): ModelConfig {
  if (NODE_MODEL_POOL.length === 0) return modelFor("node", env);
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

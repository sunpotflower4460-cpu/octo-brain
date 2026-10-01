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

export type ModelRole = "router" | "node" | "synth" | "verifier" | "mapper" | "worlds";

export type ModelProvider = "openai-compat" | "gemini" | "anthropic";

export interface ModelConfig {
  provider: ModelProvider;
  baseURL?: string; // openai-compat のとき必須 (DeepSeek/Mistral/OpenAI等を切替)
  model: string; // ← 実装時に最新価格を確認して設定。ドキュメントには書かない
  maxTokens: number;
  keyEnv: string; // 参照する環境変数名 (例: "DEEPSEEK_API_KEY")
  pricePerMTokIn: number; // USD / 100万入力トークン
  pricePerMTokOut: number; // USD / 100万出力トークン
  // キャッシュ済み入力の単価(プロンプトの先頭が直近の呼び出しと同じとき自動で安くなる)。未設定なら通常単価
  pricePerMTokCachedIn?: number;
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

export const MODEL_ROLES: ModelRole[] = ["router", "node", "synth", "verifier", "mapper", "worlds"];

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
  pricePerMTokCachedIn: 0.01,
  extraBody: { reasoning_effort: "none" },
  maxTokensParam: "max_completion_tokens",
} as const satisfies Omit<ModelConfig, "maxTokens">;

// 比較評価用(開発環境の /api/dev/baseline だけで使う)。「普通のチャットボット」相当:
// 同じ Luna を推論つき(既定の medium)で1回呼ぶ構成と、上位の GPT-6.1 Sol。
// 審査役は Sol と、別の会社の DeepSeek V4 Pro(OpenAI 同士の自己びいきを避けるため両方で採点する)。


// 役割ごとの max_tokens。docs/00_architecture.md §6 の設計に合わせる。
// synth は日本語ほぼ1字≒1トークンで本文700字目安+機械可読ブロックが切れない余裕、
// verifier は修正時に全文を出し直すため synth と同じ上限(通常は "pass" のみで安い)。
const MAX_TOKENS: Record<ModelRole, number> = {
  router: 10,
  // 世界つきのときは「その世界の経験」と「実際の情報」も返すので広めに取る
  node: 500,
  synth: 2000,
  verifier: 2000,
  // 視点の地図(番号で答える小さな JSON)
  // 世界をまたぐ本質も返すときがあるので余裕を持たせる(切れると地図全体が読めない)
  mapper: 700,
  // 視点の世界の選定(8つの世界の名前と日常+何を調べるかを短い JSON で)
  worlds: 900,
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
    mapper: { ...FLASH, maxTokens: MAX_TOKENS.mapper },
    worlds: { ...FLASH, maxTokens: MAX_TOKENS.worlds },
  },
  luna: {
    router: { ...LUNA, maxTokens: MAX_TOKENS.router },
    node: { ...LUNA, maxTokens: MAX_TOKENS.node },
    synth: { ...LUNA, maxTokens: MAX_TOKENS.synth },
    verifier: { ...LUNA, maxTokens: MAX_TOKENS.verifier },
    mapper: { ...LUNA, maxTokens: MAX_TOKENS.mapper },
    worlds: { ...LUNA, maxTokens: MAX_TOKENS.worlds },
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

// ---------------------------------------------------------------------------
// 無料枠のプロバイダー(混雑時の切り替え先)。課金なし運用のため、有料の DeepSeek より先に使う。
// - Groq: クレジットカード不要・無料(モデルごとに1分30回ほど・1日の上限あり)
// - さくらのAI Engine: 月3,000リクエストまで無料(超えても自動課金されず、速度が絞られるだけ)
// どちらも gpt-oss(推論モデル)。推論は low にし、推論分の出力予算を上乗せする。単価は0で記録する。
// キーが無ければ使わない。上限が小さいので主には使わず、混雑・障害時の受け皿にする。
// ---------------------------------------------------------------------------
const FREE_BASE = {
  provider: "openai-compat",
  pricePerMTokIn: 0,
  pricePerMTokOut: 0,
  extraBody: { reasoning_effort: "low" },
  maxTokensParam: "max_completion_tokens",
  reasoningBudget: 1500,
} as const;

const GROQ_SMALL = { ...FREE_BASE, baseURL: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-20b", keyEnv: "GROQ_API_KEY" } as const satisfies Omit<ModelConfig, "maxTokens">;
const GROQ_LARGE = { ...GROQ_SMALL, model: "openai/gpt-oss-120b" } as const satisfies Omit<ModelConfig, "maxTokens">;
const SAKURA = { ...FREE_BASE, baseURL: "https://api.ai.sakura.ad.jp/v1", model: "gpt-oss-120b", keyEnv: "SAKURA_API_KEY" } as const satisfies Omit<ModelConfig, "maxTokens">;

export type BaselineModel = "luna" | "sol" | "pro" | "groq" | "sakura";

export const BASELINE_MODELS: Record<BaselineModel, ModelConfig> = {
  luna: {
    ...LUNA,
    extraBody: { reasoning_effort: "medium" },
    maxTokens: 2000,
    reasoningBudget: 8000,
  },
  sol: {
    provider: "openai-compat",
    baseURL: "https://api.openai.com/v1",
    model: "gpt-6.1-sol",
    keyEnv: "OPENAI_API_KEY",
    pricePerMTokIn: 2,
    pricePerMTokOut: 10,
    pricePerMTokCachedIn: 0.1,
    extraBody: { reasoning_effort: "medium" },
    maxTokensParam: "max_completion_tokens",
    maxTokens: 3000,
    reasoningBudget: 8000,
  },
  // 評価の審査役(別の会社のモデル。OpenAI 同士の自己びいきを避ける)
  pro: { ...PRO, maxTokens: 4000 },
  // 無料の審査役(Groq の Meta Llama。OpenAI 系と違う会社のモデル)
  groq: {
    provider: "openai-compat",
    baseURL: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
    keyEnv: "GROQ_API_KEY",
    pricePerMTokIn: 0,
    pricePerMTokOut: 0,
    maxTokens: 3000,
  },
  // 無料の審査役(さくらのAI Engine。月3,000回まで無料)
  sakura: { ...SAKURA, maxTokens: 3000, reasoningBudget: 3000 },
};
// 役割ごとの無料枠の構成。統合脳は大きいモデル、ほかの狭い作業は小さく速いモデル
function freeTierFor(role: ModelRole): ModelConfig[] {
  const maxTokens = MAX_TOKENS[role];
  return [{ ...(role === "synth" ? GROQ_LARGE : GROQ_SMALL), maxTokens }, { ...SAKURA, maxTokens }];
}

const hasKey = (env: Record<string, unknown>, cfg: ModelConfig) => {
  const key = env[cfg.keyEnv];
  return typeof key === "string" && key.length > 0;
};

// 混雑(429)や障害(5xx)で主のプロバイダーが応答できないときの切り替え先(試す順)。
// 1. 無料枠(Groq → さくら)  2. もう一方の構成の同じ役割(DeepSeek / Luna)
// キーが無いものは除く。MODEL_FALLBACK="off" なら空、FREE_FALLBACK="off" なら無料枠を使わない。
export function fallbackChain(
  role: ModelRole,
  env: Record<string, unknown>,
  primary: ModelConfig,
): ModelConfig[] {
  if (env.MODEL_FALLBACK === "off") return [];
  const free = env.FREE_FALLBACK === "off" ? [] : freeTierFor(role).filter((c) => hasKey(env, c) && c.model !== primary.model);
  const other: ModelProfile = primary.keyEnv === PROFILES.luna[role].keyEnv ? "deepseek" : "luna";
  const paid = PROFILES[other][role];
  return [...free, ...(hasKey(env, paid) && paid.model !== primary.model ? [paid] : [])];
}

// 互換: 最初の切り替え先
export function fallbackFor(
  role: ModelRole,
  env: Record<string, unknown>,
  primary: ModelConfig,
): ModelConfig | null {
  return fallbackChain(role, env, primary)[0] ?? null;
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
// cachedTok: 入力のうちキャッシュから読まれた分(OpenAI の usage.prompt_tokens_details.cached_tokens)
export function estimateCost(
  cfg: ModelConfig,
  inTok: number,
  outTok: number,
  cachedTok = 0,
): number {
  const cached = Math.min(Math.max(cachedTok, 0), inTok);
  return (
    ((inTok - cached) / 1_000_000) * cfg.pricePerMTokIn +
    (cached / 1_000_000) * (cfg.pricePerMTokCachedIn ?? cfg.pricePerMTokIn) +
    (outTok / 1_000_000) * cfg.pricePerMTokOut
  );
}

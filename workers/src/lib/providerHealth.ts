// 混雑・障害が起きたプロバイダーを、同じ実行環境(isolate)の中でしばらく避ける。
// 429/5xx/接続失敗が出た相手に、次のリクエストでもまず当たって待つ・外部呼び出し回数を使う、を防ぐ。
// (Workers 無料プランは1リクエストの外部呼び出しが50回まで)

import type { ModelConfig } from "../config/models.js";

const COOLDOWN_MS = 20_000;
const MAX_COOLDOWN_MS = 60_000;
const cooling = new Map<string, number>();

function keyOf(cfg: ModelConfig): string {
  return `${cfg.baseURL ?? cfg.provider}|${cfg.model}`;
}

export function isCooling(cfg: ModelConfig, now = Date.now()): boolean {
  const until = cooling.get(keyOf(cfg));
  return until !== undefined && until > now;
}

// retryAfterMs: プロバイダーが示した待ち時間(あれば)。上限1分
export function coolDown(cfg: ModelConfig, retryAfterMs = 0, now = Date.now()): void {
  cooling.set(keyOf(cfg), now + Math.min(Math.max(COOLDOWN_MS, retryAfterMs), MAX_COOLDOWN_MS));
}

// 試す順の候補から、休ませている相手を外す。全部休ませているときは最後の1つだけ試す
export function liveCandidates(list: ModelConfig[], now = Date.now()): ModelConfig[] {
  const live = list.filter((c) => !isCooling(c, now));
  return live.length > 0 ? live : list.slice(-1);
}

// テスト用
export function resetCooldowns(): void {
  cooling.clear();
}

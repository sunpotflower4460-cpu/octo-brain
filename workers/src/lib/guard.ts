// P5 堅牢化: クォータの実ブロック + 連打防止(同時実行1本 + 最小間隔)。
// KV は結果整合のため厳密な相互排他はできない。あくまで軽量な連打抑止 + コスト線形化。
// クォータの残量チェックは「読むだけ」で安全側(多少の超過は許容しユーザーを不当に止めない)。

import type { Env } from "../types.js";
import { quotaKey, readDailySpendUsd } from "./costlog.js";

export const DEFAULT_FREE_MONTHLY_QUOTA = 100;
export const DEFAULT_MIN_INTERVAL_MS = 1500;
export const DEFAULT_LOCK_MS = 40_000; // 全体予算(既定30s)より少し長く。異常終了時も lockUntil で自己回復
export const DEFAULT_REQUEST_BUDGET_MS = 30_000;
// IP 単位の1日上限(クォータ単位)。clientId を使い捨てて無料枠を回す濫用への原価の天井。
// 携帯回線の CGNAT で複数人が同一IPになり得るため、個人の月間枠より十分大きく取る。
export const DEFAULT_IP_DAILY_QUOTA = 300;
const RL_TTL_SEC = 120;
const IP_QUOTA_TTL_SEC = 2 * 24 * 60 * 60;

// ---- clientId 検証 ----
// クライアント生成の不透明ID(UUID 等)。KV キー長上限(512B)超過で KV 例外→ガードが
// 素通りになるのを防ぐため、文字種と長さを入口で固定する。
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidClientId(v: unknown): v is string {
  return typeof v === "string" && CLIENT_ID_RE.test(v);
}

// ---- クォータ消費単位 ----
// LLM 原価に比例させる。deep(8腕)と深化(5コール+統合)は light の約2倍。
export type QuotaKind = "light" | "deep" | "deepen" | "resonate";
export const QUOTA_UNITS: Record<QuotaKind, number> = {
  light: 1,
  deep: 2,
  deepen: 2,
  resonate: 1,
};

// deep プランの提供可否。課金なし運用での原価調整スイッチ("false" で deep を 403 にする)。既定は有効。
export function deepPlanEnabled(env: Env): boolean {
  return env.DEEP_PLAN_ENABLED !== "false";
}

// 数値の環境変数を安全に読む(未設定/不正は既定へ)。
export function numEnv(env: Env, key: string, fallback: number): number {
  const raw = env[key];
  const n = typeof raw === "string" ? parseInt(raw, 10) : typeof raw === "number" ? raw : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function quotaLimit(env: Env): number {
  return numEnv(env, "FREE_MONTHLY_QUOTA", DEFAULT_FREE_MONTHLY_QUOTA);
}

export function requestBudgetMs(env: Env): number {
  return numEnv(env, "REQUEST_BUDGET_MS", DEFAULT_REQUEST_BUDGET_MS);
}

// ---- クォータ残量チェック(ブロック判定) ----
export interface QuotaState {
  used: number;
  limit: number;
  allowed: boolean;
}

export async function checkQuota(
  kv: KVNamespace,
  clientId: string,
  now: Date,
  limit: number,
  units = 1,
): Promise<QuotaState> {
  let used = 0;
  try {
    const cur = await kv.get(quotaKey(clientId, now));
    const parsed = cur ? parseInt(cur, 10) : 0;
    used = Number.isFinite(parsed) ? parsed : 0;
  } catch {
    // KV 読み取り失敗は安全側(ブロックしない)
    used = 0;
  }
  // 今回の消費分(units)を足して上限以内なら受理。deep(2単位)は残り1では通さない。
  return { used, limit, allowed: used + units <= limit };
}

// ---- 全体の1日予算(課金なし運用のサーキットブレーカー) ----
// 収益が無いので、原価の上限は運営が決めた1日の予算で物理的に止める。
// DAILY_BUDGET_USD(wrangler vars、既定 $3/日 ≒ 月 $90)を超えたら当日は新規受付を止める(UTC 0時に復帰)。
export const DEFAULT_DAILY_BUDGET_USD = 3;

export function dailyBudgetUsd(env: Env): number {
  const raw = env.DAILY_BUDGET_USD;
  const n = typeof raw === "string" ? parseFloat(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_BUDGET_USD;
}

export async function checkDailyBudget(
  kv: KVNamespace,
  env: Env,
  now: Date,
): Promise<{ allowed: boolean; spentUsd: number; budgetUsd: number }> {
  const budgetUsd = dailyBudgetUsd(env);
  let spentUsd = 0;
  try {
    spentUsd = await readDailySpendUsd(kv, now);
  } catch {
    // KV 読み取り失敗は安全側(止めない)。個人・IP の上限は別に効いている
  }
  return { allowed: spentUsd < budgetUsd, spentUsd, budgetUsd };
}

// ---- IP 単位の1日上限 ----
export function ipQuotaKey(ip: string, now: Date): string {
  const d = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}`;
  return `ipq:${ip}:${d}`;
}

// 読んで上限判定し、受理なら units を加算して保存する(受理時点で課金=失敗リクエストも数える)。
// KV は結果整合のため同時多発では多少超過し得る(天井を線形に保つのが目的)。
// KV 失敗は安全側(ブロックしない)だが、呼び出し側で warnings に載せられるよう ok=false を返す。
export async function consumeIpQuota(
  kv: KVNamespace,
  ip: string,
  now: Date,
  units: number,
  limit: number,
): Promise<{ allowed: boolean; used: number; limit: number; kvOk: boolean }> {
  const key = ipQuotaKey(ip, now);
  try {
    const cur = await kv.get(key);
    const parsed = cur ? parseInt(cur, 10) : 0;
    const used = Number.isFinite(parsed) ? parsed : 0;
    if (used >= limit) return { allowed: false, used, limit, kvOk: true };
    await kv.put(key, String(used + units), { expirationTtl: IP_QUOTA_TTL_SEC });
    return { allowed: true, used: used + units, limit, kvOk: true };
  } catch {
    return { allowed: true, used: 0, limit, kvOk: false };
  }
}

// ---- 連打防止(同時実行1本 + 最小間隔) ----
interface RlState {
  inFlight: boolean;
  lockUntil: number; // この時刻まで in_flight を有効とみなす(異常終了の自己回復)
  last: number; // 直近で受理したリクエストの開始時刻
}

export interface SlotOpts {
  minIntervalMs: number;
  lockMs: number;
}

export type SlotResult =
  | { ok: true }
  | { ok: false; error: "in_progress" | "too_frequent"; retryAfterMs: number };

const rlKey = (clientId: string) => `rl:${clientId}`;

async function readRl(kv: KVNamespace, clientId: string): Promise<RlState> {
  try {
    const cur = await kv.get(rlKey(clientId));
    if (cur) {
      const st = JSON.parse(cur) as Partial<RlState>;
      return {
        inFlight: !!st.inFlight,
        lockUntil: typeof st.lockUntil === "number" ? st.lockUntil : 0,
        last: typeof st.last === "number" ? st.last : 0,
      };
    }
  } catch {
    /* 破損/失敗は初期状態扱い */
  }
  return { inFlight: false, lockUntil: 0, last: 0 };
}

async function writeRl(kv: KVNamespace, clientId: string, st: RlState): Promise<void> {
  try {
    await kv.put(rlKey(clientId), JSON.stringify(st), { expirationTtl: RL_TTL_SEC });
  } catch {
    /* 書き込み失敗は非致命(連打抑止が緩むだけ) */
  }
}

// スロット取得。取れたら inFlight を立てて last を更新する。
export async function acquireSlot(
  kv: KVNamespace,
  clientId: string,
  now: number,
  opts: SlotOpts,
): Promise<SlotResult> {
  const st = await readRl(kv, clientId);

  if (st.inFlight && now < st.lockUntil) {
    return { ok: false, error: "in_progress", retryAfterMs: st.lockUntil - now };
  }
  const since = now - st.last;
  if (st.last > 0 && since >= 0 && since < opts.minIntervalMs) {
    return { ok: false, error: "too_frequent", retryAfterMs: opts.minIntervalMs - since };
  }

  await writeRl(kv, clientId, { inFlight: true, lockUntil: now + opts.lockMs, last: now });
  return { ok: true };
}

// スロット解放。inFlight を下ろす(last=受理時刻はそのまま保持し最小間隔の基準に使う)。
// 引数 now は将来の拡張用に残す(現状は last を上書きしない)。
export async function releaseSlot(
  kv: KVNamespace,
  clientId: string,
  _now: number,
): Promise<void> {
  const st = await readRl(kv, clientId);
  await writeRl(kv, clientId, {
    inFlight: false,
    lockUntil: 0,
    last: st.last,
  });
}

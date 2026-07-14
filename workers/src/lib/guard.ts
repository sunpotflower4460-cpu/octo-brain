// P5 堅牢化: クォータの実ブロック + 連打防止(同時実行1本 + 最小間隔)。
// KV は結果整合のため厳密な相互排他はできない。あくまで軽量な連打抑止 + コスト線形化。
// クォータの残量チェックは「読むだけ」で安全側(多少の超過は許容しユーザーを不当に止めない)。

import type { Env } from "../types.js";
import { quotaKey } from "./costlog.js";

export const DEFAULT_FREE_MONTHLY_QUOTA = 100;
export const DEFAULT_MIN_INTERVAL_MS = 1500;
export const DEFAULT_LOCK_MS = 40_000; // 全体予算(既定30s)より少し長く。異常終了時も lockUntil で自己回復
export const DEFAULT_REQUEST_BUDGET_MS = 30_000;
const RL_TTL_SEC = 120;

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
  return { used, limit, allowed: used < limit };
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

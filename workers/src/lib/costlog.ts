// 原価ログ・クォータ (docs/00_architecture.md §8)。
// リクエスト内の全 callModel レコードを集約して cost:{yyyymmdd}:{requestId} に1件保存。
// quota:{clientId}:{yyyymm} をインクリメント (この段階ではブロックしない。読んで返すだけ)。

import type { CostCallRecord, CostSink } from "../types.js";

const COST_TTL_SEC = 90 * 24 * 60 * 60; // 90日
const QUOTA_TTL_SEC = 62 * 24 * 60 * 60; // 62日

// リクエスト単位の原価コレクタ。callModel が record() で1件ずつ書き込む。
export class CostCollector implements CostSink {
  readonly calls: CostCallRecord[] = [];

  record(rec: CostCallRecord): void {
    this.calls.push(rec);
  }

  totalCost(): number {
    return this.calls.reduce((sum, c) => sum + c.estCost, 0);
  }
}

export interface CostLogMeta {
  quorum: string; // 例: "6/8"
  fallback: boolean;
  ms?: number; // リクエスト全体の実時間(ops:report の平均レイテンシ用)
  kind?: string; // "analyze" | "deepen" | "resonate" 等(集計の内訳用)
}

export interface StoredCostRecord {
  calls: CostCallRecord[];
  totalCost: number;
  quorum: string;
  fallback: boolean;
  ms?: number;
  kind?: string;
}

// §8: cost:{yyyymmdd}:{requestId} に集約1件を保存。
export async function logCost(
  kv: KVNamespace,
  requestId: string,
  collector: CostCollector,
  meta: CostLogMeta,
  now: Date,
): Promise<void> {
  const key = `cost:${yyyymmdd(now)}:${requestId}`;
  const value: StoredCostRecord = {
    calls: collector.calls,
    totalCost: collector.totalCost(),
    quorum: meta.quorum,
    fallback: meta.fallback,
    ms: meta.ms,
    kind: meta.kind,
  };
  await kv.put(key, JSON.stringify(value), { expirationTtl: COST_TTL_SEC });
  // 全体の1日原価(課金なし運用の天井)。失敗・中断も含め、実際に払った分を積む
  await addDailySpend(kv, value.totalCost, now);
}

// ---- 全体の1日原価(課金なし運用のサーキットブレーカー用) ----
// マイクロドル(整数)で積む。KV は結果整合なので同時多発では多少取りこぼすが、天井の目安には十分。
const SPEND_TTL_SEC = 3 * 24 * 60 * 60;

export function spendKey(now: Date): string {
  return `spend:${yyyymmdd(now)}`;
}

export async function readDailySpendUsd(kv: KVNamespace, now: Date): Promise<number> {
  const cur = await kv.get(spendKey(now));
  const micro = cur ? parseInt(cur, 10) : 0;
  return Number.isFinite(micro) ? micro / 1_000_000 : 0;
}

async function addDailySpend(kv: KVNamespace, usd: number, now: Date): Promise<void> {
  if (!(usd > 0)) return;
  const key = spendKey(now);
  const cur = await kv.get(key);
  const parsed = cur ? parseInt(cur, 10) : 0;
  const next = (Number.isFinite(parsed) ? parsed : 0) + Math.round(usd * 1_000_000);
  await kv.put(key, String(next), { expirationTtl: SPEND_TTL_SEC });
}

// 失敗・中断・予算超過で途中終了したリクエストの原価を記録する(ベストエフォート)。
// 途中までに完了したモデル呼び出しは課金済みのため、成功時だけ記録すると原価が過少になる。
// KV 失敗はここでは投げない(元のエラーを優先して呼び出し側へ伝播させるため)。
export async function logFailedCost(
  kv: KVNamespace,
  requestId: string,
  collector: CostCollector,
  kind: string,
  startedMs: number,
  now: Date,
): Promise<void> {
  if (collector.calls.length === 0) return;
  try {
    await logCost(
      kv,
      requestId,
      collector,
      { quorum: "failed", fallback: false, ms: Date.now() - startedMs, kind: `${kind}_failed` },
      now,
    );
  } catch {
    /* 元のエラーを優先 */
  }
}

// quota キーの生成(guard の残量チェックと共有し、キー形式を一元管理)。
export function quotaKey(clientId: string, now: Date): string {
  return `quota:${clientId}:${yyyymm(now)}`;
}

// §8: quota:{clientId}:{yyyymm} を units(既定1)だけ加算。新しい使用量を返す。
// units は原価比例の消費単位(guard.ts の QUOTA_UNITS)。
export async function incrementQuota(
  kv: KVNamespace,
  clientId: string,
  now: Date,
  units = 1,
): Promise<number> {
  const key = quotaKey(clientId, now);
  const cur = await kv.get(key);
  const parsed = cur ? parseInt(cur, 10) : 0;
  const next = (Number.isFinite(parsed) ? parsed : 0) + units;
  await kv.put(key, String(next), { expirationTtl: QUOTA_TTL_SEC });
  return next;
}

function yyyymmdd(d: Date): string {
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`;
}

function yyyymm(d: Date): string {
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

// 利用回数の見える化。上限に達して急に使えなくなる体験を避けるため、残りが少なくなったら知らせる。
import type { QuotaStatus } from "../types";

const DAY_WARN = 5; // 今日の残りがこれ以下で表示
const MONTH_WARN = 10; // 今月の残りがこれ以下で表示

// 入力欄の上に出す短い注意。残りに余裕があるときは null(普段は表示しない)。
export function quotaNote(q: QuotaStatus | null): string | null {
  if (!q) return null;
  const day = Math.max(0, q.dayLimit - q.dayUsed);
  const month = Math.max(0, q.limit - q.used);
  if (month <= MONTH_WARN && month <= day) return `今月の残り ${month}回分`;
  if (day <= DAY_WARN) return `今日の残り ${day}回分`;
  return null;
}

// 設定画面に出す利用状況
export function quotaSummary(q: QuotaStatus | null): string {
  if (!q) return "まだ記録がありません(最初の回答のあとに表示されます)";
  return `今日 ${q.dayUsed}/${q.dayLimit}回分 ・ 今月 ${q.used}/${q.limit}回分`;
}

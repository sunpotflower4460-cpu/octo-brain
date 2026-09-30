// P5: バックエンドの構造化エラー(429/504/4xx/5xx)を、生の本文を出さずに
// ユーザー向けの平易な日本語へ変換する。api クライアントとテストで共有。

export interface HumanError {
  code: string;
  message: string;
  retryAfterMs?: number;
}

export function humanizeApiError(status: number, body: unknown): HumanError {
  const b = (body ?? {}) as Record<string, unknown>;
  const code = typeof b.error === "string" ? b.error : `http_${status}`;
  const retryAfterMs = typeof b.retryAfterMs === "number" ? b.retryAfterMs : undefined;
  const limit = typeof b.limit === "number" ? b.limit : undefined;
  const used = typeof b.used === "number" ? b.used : undefined;

  switch (code) {
    case "quota_exceeded":
      // 残りはあるが今回の消費単位(ディープ=2)に足りない場合
      if (limit !== undefined && used !== undefined && used < limit) {
        return {
          code,
          message: "今月の無料枠の残りが足りません。ライトならまだ使えます。",
        };
      }
      return {
        code,
        message: limit
          ? `今月の無料回数(${limit}回)を使い切りました。翌月にリセットされます。`
          : "今月の無料回数を使い切りました。翌月にリセットされます。",
      };
    case "ip_rate_limited":
      return {
        code,
        message: "混み合っています。1分ほどおいてから、もう一度お試しください。",
        retryAfterMs,
      };
    case "ip_quota_exceeded":
      return {
        code,
        message: "本日の利用上限に達しました。明日もう一度お試しください。",
      };
    case "daily_budget_exceeded":
      return {
        code,
        message: "本日の無料提供分がいっぱいになりました。明日またお試しください。",
      };
    case "plan_not_available":
      return { code, message: "ディープは現在ご利用いただけません。ライトでお試しください。" };
    case "too_frequent":
      return {
        code,
        message: "少し早すぎます。数秒おいてから、もう一度お試しください。",
        retryAfterMs,
      };
    case "in_progress":
      return {
        code,
        message: "前の思考がまだ進行中です。完了してからお試しください。",
        retryAfterMs,
      };
    case "timeout":
      return {
        code,
        message: "時間内に考えきれませんでした。もう一度お試しください。",
      };
    case "input_too_long":
      return { code, message: "入力が長すぎます。短くしてからお試しください。" };
    case "input_required":
      return { code, message: "入力が空です。問いを入力してください。" };
    default:
      if (status >= 500) {
        return { code, message: "サーバー側で問題が発生しました。時間をおいてお試しください。" };
      }
      return { code, message: "うまく処理できませんでした。もう一度お試しください。" };
  }
}

// ネットワーク断・中断の文面(生のエラーは出さない)。ユーザー中断は別処理なので
// ここでは接続不能のみを扱う。
export function networkErrorMessage(): string {
  return "接続できませんでした。ネットワークを確認して、もう一度お試しください。";
}

// deepen / resonate が投げる構造化エラー。App の catch で message をそのまま表示できる。
export class ApiError extends Error {
  code: string;
  status: number;
  retryAfterMs?: number;
  constructor(info: HumanError, status: number) {
    super(info.message);
    this.name = "ApiError";
    this.code = info.code;
    this.status = status;
    this.retryAfterMs = info.retryAfterMs;
  }
}

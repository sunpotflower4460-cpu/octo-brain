import { describe, expect, it } from "vitest";
import { humanizeApiError, ApiError, networkErrorMessage } from "./apiError";

describe("humanizeApiError", () => {
  it("quota_exceeded は残量メッセージ(上限つき)", () => {
    const h = humanizeApiError(429, { error: "quota_exceeded", limit: 100, used: 100 });
    expect(h.code).toBe("quota_exceeded");
    expect(h.message).toContain("100回");
  });

  it("too_frequent は retryAfterMs を保持", () => {
    const h = humanizeApiError(429, { error: "too_frequent", retryAfterMs: 1200 });
    expect(h.code).toBe("too_frequent");
    expect(h.retryAfterMs).toBe(1200);
    expect(h.message).toContain("数秒");
  });

  it("in_progress は進行中メッセージ", () => {
    expect(humanizeApiError(429, { error: "in_progress" }).message).toContain("進行中");
  });

  it("timeout は考えきれなかった旨", () => {
    expect(humanizeApiError(504, { error: "timeout" }).message).toContain("考えきれ");
  });

  it("未知コードで 5xx はサーバー障害メッセージ", () => {
    const h = humanizeApiError(500, { error: "pipeline_error" });
    expect(h.message).toContain("サーバー");
  });

  it("本文が空でも落ちない(http_<status>)", () => {
    const h = humanizeApiError(503, {});
    expect(h.code).toBe("http_503");
    expect(h.message).toContain("サーバー");
  });

  it("生のHTTP本文・スタックを露出しない", () => {
    const h = humanizeApiError(500, { error: "boom", message: "at Object.<anonymous> secret" });
    expect(h.message).not.toContain("secret");
    expect(h.message).not.toContain("at Object");
  });
});

describe("ApiError", () => {
  it("message/code/status/retryAfterMs を保持する", () => {
    const e = new ApiError(
      { code: "too_frequent", message: "少し早すぎます", retryAfterMs: 500 },
      429,
    );
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe("少し早すぎます");
    expect(e.code).toBe("too_frequent");
    expect(e.status).toBe(429);
    expect(e.retryAfterMs).toBe(500);
  });
});

describe("networkErrorMessage", () => {
  it("接続不能の平易な文面", () => {
    expect(networkErrorMessage()).toContain("接続");
  });
});

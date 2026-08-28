import { describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/callModel.js", () => ({ callModel: vi.fn() }));

import { callModel } from "../src/lib/callModel.js";
import { verify } from "../src/lib/verify.js";
import type { Env, ModelCallResult } from "../src/types.js";

const mockedCall = vi.mocked(callModel);
const env: Env = { OCTO_KV: {} as KVNamespace, DEEPSEEK_API_KEY: "k" };

function result(text: string): ModelCallResult {
  return { text, inTok: 0, outTok: 0, ms: 0, estimated: false };
}

describe("verify", () => {
  it("pass / pass. / PASS! は無修正", async () => {
    for (const t of ["pass", "pass.", "PASS!", "  pass。  "]) {
      mockedCall.mockResolvedValueOnce(result(t));
      const r = await verify("元の回答", { env });
      expect(r).toEqual({ text: "元の回答", modified: false });
    }
  });

  it("pass 以外の文言は修正済み本文として採用", async () => {
    mockedCall.mockResolvedValueOnce(result("pass\nOKです"));
    const r = await verify("元の回答", { env });
    expect(r.modified).toBe(true);
    expect(r.text).toBe("pass\nOKです");
  });

  it("空応答は安全側で無修正", async () => {
    mockedCall.mockResolvedValueOnce(result("   "));
    const r = await verify("元の回答", { env });
    expect(r).toEqual({ text: "元の回答", modified: false });
  });
});

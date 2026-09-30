import { describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/callModel.js", () => ({
  callModel: vi.fn(async () => ({ text: "本文\n---SUMMARY---\n要約", inTok: 0, outTok: 0, ms: 0, estimated: false })),
}));

import { callModel } from "../src/lib/callModel.js";
import { synthesize, synthesizeFallback } from "../src/lib/synthesize.js";
import type { ChatMessage, Env } from "../src/types.js";

// 回帰テスト: 統合プロンプトを書き直した際に安全指示が本体から消えていた(PR #35)。
// 通常の統合・フォールバックのどちらにも、危機対応の指示が必ず入っていること。
const env = { OCTO_KV: {} as KVNamespace, DEEPSEEK_API_KEY: "k" } as Env;
const systemOf = () => ((vi.mocked(callModel).mock.calls.at(-1)?.[1] ?? []) as ChatMessage[])[0].content;

describe("統合プロンプトの安全指示", () => {
  it("通常の統合", async () => {
    await synthesize("x", "", [], { env });
    const sys = systemOf();
    expect(sys).toContain("希死念慮");
    expect(sys).toContain("0120-279-338");
    expect(sys).toContain("方法や手段に関する情報は一切出さない");
  });
  it("フォールバック(腕の補助なし)", async () => {
    await synthesizeFallback("x", "", { env });
    const sys = systemOf();
    expect(sys).toContain("希死念慮");
    expect(sys).toContain("方法や手段に関する情報は一切出さない");
  });
});

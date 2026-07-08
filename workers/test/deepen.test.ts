import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/callModel.js", () => ({ callModel: vi.fn() }));

import { callModel } from "../src/lib/callModel.js";
import { runDeepen, resolveAxis } from "../src/lib/deepen.js";
import type { ModelRole } from "../src/config/models.js";
import type { ChatMessage, Env, ModelCallResult } from "../src/types.js";

const mockedCall = vi.mocked(callModel);

function result(text: string): ModelCallResult {
  return { text, inTok: 0, outTok: 0, ms: 0, estimated: false };
}
const OK_JSON = JSON.stringify({
  opinions: [{ claim: "意見", weight: 0.8, why: "理由" }],
  flag: null,
});

function makeEnv(): { env: Env; store: Map<string, string> } {
  const store = new Map<string, string>();
  const kv = {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => {
      store.set(k, v);
    },
  } as unknown as KVNamespace;
  return { env: { OCTO_KV: kv, DEEPSEEK_API_KEY: "k" }, store };
}

beforeEach(() => {
  mockedCall.mockReset();
});

describe("resolveAxis", () => {
  it("既知の軸ラベルを解決する", () => {
    expect(resolveAxis("心の軸")?.lenses).toEqual(["emotion", "truth"]);
    expect(resolveAxis("時の軸")?.lenses).toEqual(["reason", "future"]);
  });
  it("未知の軸は null", () => {
    expect(resolveAxis("謎の軸")).toBeNull();
    expect(resolveAxis("")).toBeNull();
  });
});

describe("runDeepen (腕間結合)", () => {
  it("最緊張軸の対角2腕を再考させ、中央脳が織り直す", async () => {
    mockedCall.mockImplementation(
      ((role: ModelRole, messages: ChatMessage[]) => {
        const sys = messages[0]?.content ?? "";
        if (role === "synth") return Promise.resolve(result("織り直した深い回答"));
        if (sys.includes("再考")) {
          return Promise.resolve(result('{"keep":"譲れない核心","changed":"変わった点"}'));
        }
        return Promise.resolve(result(OK_JSON)); // base lens
      }) as unknown as typeof callModel,
    );
    const { env, store } = makeEnv();

    const res = await runDeepen(
      {
        input: "テスト入力",
        summary: "",
        tension: { axis: "心の軸" },
        priorAnswer: "以前の回答",
        clientId: "c1",
      },
      { env, now: new Date(), requestId: "dpn-1" },
    );

    expect(res.answer).toBe("織り直した深い回答");
    expect(res.meta.axis).toBe("心の軸");

    // 2腕base + 2腕再考 + 1中央 = 5コール
    expect(mockedCall).toHaveBeenCalledTimes(5);
    const roles = mockedCall.mock.calls.map((c) => c[0]);
    expect(roles.filter((r) => r === "node")).toHaveLength(4);
    expect(roles.filter((r) => r === "synth")).toHaveLength(1);

    // 再考コールに対角相手の意見が渡っている(腕間結合)
    const reconUsers = mockedCall.mock.calls
      .filter(
        (c) => c[0] === "node" && (c[1] as ChatMessage[])[0].content.includes("再考"),
      )
      .map((c) => (c[1] as ChatMessage[])[1].content);
    expect(reconUsers).toHaveLength(2);
    expect(reconUsers.some((u) => u.includes("対角("))).toBe(true);

    // KV に原価記録
    expect([...store.keys()].some((k) => k.startsWith("cost:"))).toBe(true);
  });

  it("未知の軸ではエラー(深化ガード)", async () => {
    const { env } = makeEnv();
    await expect(
      runDeepen(
        {
          input: "x",
          summary: "",
          tension: { axis: "存在しない軸" },
          priorAnswer: "",
          clientId: "c1",
        },
        { env, now: new Date(), requestId: "dpn-2" },
      ),
    ).rejects.toThrow(/unknown_axis/);
  });
});

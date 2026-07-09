import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/callModel.js", () => ({ callModel: vi.fn() }));
vi.mock("../src/lib/callModelStream.js", () => ({ callModelStream: vi.fn() }));

import { callModel } from "../src/lib/callModel.js";
import { runAnalyze } from "../src/lib/analyze.js";
import type { ModelRole } from "../src/config/models.js";
import type { ChatMessage, Env, ModelCallResult } from "../src/types.js";

const mockedCall = vi.mocked(callModel);

function result(text: string): ModelCallResult {
  return { text, inTok: 0, outTok: 0, ms: 0, estimated: false };
}
const OK_JSON = JSON.stringify({
  opinions: [{ claim: "論点", weight: 0.8, why: "理由" }],
  flag: null,
});
const SYNTH_TENSION =
  '最終回答本文\n---TENSION--- {"axis":"心の軸","reason":"r"}\n---SUMMARY---\n新しい要約';
const SYNTH_NO_TENSION = "フォールバック回答\n---SUMMARY---\n要約";
const SYNTH_RESONANCE =
  '回答本文\n---RESONANCE--- {"a":{"lens":"risk","claim":"x"},"b":{"lens":"values","claim":"y"},"root":"共通の根"}\n' +
  '---TENSION--- {"axis":"心の軸","reason":"r"}\n---SUMMARY---\n要約v';

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

function dispatch(domain: string, nodeText: string, synthText: string, verifyText = "pass") {
  return (role: ModelRole, _messages: ChatMessage[]): Promise<ModelCallResult> => {
    switch (role) {
      case "router":
        return Promise.resolve(result(domain));
      case "node":
        return Promise.resolve(result(nodeText));
      case "synth":
        return Promise.resolve(result(synthText));
      case "verifier":
        return Promise.resolve(result(verifyText));
      default:
        return Promise.resolve(result(""));
    }
  };
}

beforeEach(() => {
  mockedCall.mockReset();
});

describe("runAnalyze パイプライン (P1.5)", () => {
  it("light 既定: 2軸4腕・opinions・plan/domain/tension を返す", async () => {
    mockedCall.mockImplementation(
      dispatch("general", OK_JSON, SYNTH_TENSION) as unknown as typeof callModel,
    );
    const { env, store } = makeEnv();

    const res = await runAnalyze(
      { input: "テスト入力", summary: "", plan: "light", clientId: "c1" },
      { env, now: new Date(), requestId: "req-1" },
    );

    expect(res.answer).toBe("最終回答本文");
    expect(res.summary).toBe("新しい要約");
    // general → 心+動 = 4腕
    expect(res.nodes).toHaveLength(4);
    expect(res.nodes.every((n) => n.status === "ok")).toBe(true);
    expect(res.nodes[0].opinions[0].claim).toBe("論点");
    expect(res.meta.plan).toBe("light");
    expect(res.meta.domain).toBe("general");
    expect(res.meta.quorum).toBe("4/4");
    expect(res.meta.fallback).toBe(false);
    expect(res.meta.tension).toEqual({ axis: "心の軸", reason: "r" });
    expect(res.meta.verified).toBe("pass");
    expect(res.meta.quotaUsed).toBe(1);

    expect([...store.keys()].some((k) => k.startsWith("cost:"))).toBe(true);
  });

  it("deep: 全8腕が起動する", async () => {
    mockedCall.mockImplementation(
      dispatch("work", OK_JSON, SYNTH_TENSION) as unknown as typeof callModel,
    );
    const { env } = makeEnv();

    const res = await runAnalyze(
      { input: "x", summary: "", plan: "deep", clientId: "c1" },
      { env, now: new Date(), requestId: "req-2" },
    );

    expect(res.nodes).toHaveLength(8);
    expect(res.meta.plan).toBe("deep");
    expect(res.meta.domain).toBe("work");
  });

  it("light: ドメインで起動する軸が変わる (work→時+動)", async () => {
    mockedCall.mockImplementation(
      dispatch("work", OK_JSON, SYNTH_TENSION) as unknown as typeof callModel,
    );
    const { env } = makeEnv();

    const res = await runAnalyze(
      { input: "x", summary: "", plan: "light", clientId: "c1" },
      { env, now: new Date(), requestId: "req-3" },
    );

    // work → time(reason,future) + motion(risk,step)
    const ids = res.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(["future", "reason", "risk", "step"]);
  });

  it("クォーラム未達なら fallback、tension は null", async () => {
    mockedCall.mockImplementation(
      dispatch("general", "壊れた出力", SYNTH_NO_TENSION) as unknown as typeof callModel,
    );
    const { env } = makeEnv();

    const res = await runAnalyze(
      { input: "x", summary: "", plan: "light", clientId: "c1" },
      { env, now: new Date(), requestId: "req-4" },
    );

    expect(res.meta.fallback).toBe(true);
    expect(res.answer).toBe("フォールバック回答");
    expect(res.meta.tension).toBeNull();
    expect(res.nodes.every((n) => n.status === "parse_error")).toBe(true);
  });

  it("響き合いがあれば meta.resonance が返り、無ければ null", async () => {
    // 響き合いあり
    mockedCall.mockImplementation(
      dispatch("general", OK_JSON, SYNTH_RESONANCE) as unknown as typeof callModel,
    );
    let env = makeEnv().env;
    const withRes = await runAnalyze(
      { input: "x", summary: "", plan: "deep", clientId: "c1" },
      { env, now: new Date(), requestId: "req-r1" },
    );
    expect(withRes.meta.resonance).toEqual({
      a: { lens: "risk", claim: "x" },
      b: { lens: "values", claim: "y" },
      root: "共通の根",
    });
    // 本文に機械可読行が漏れない
    expect(withRes.answer).toBe("回答本文");
    expect(withRes.answer).not.toContain("RESONANCE");

    // 響き合いなし
    mockedCall.mockImplementation(
      dispatch("general", OK_JSON, SYNTH_TENSION) as unknown as typeof callModel,
    );
    env = makeEnv().env;
    const noRes = await runAnalyze(
      { input: "x", summary: "", plan: "deep", clientId: "c1" },
      { env, now: new Date(), requestId: "req-r2" },
    );
    expect(noRes.meta.resonance).toBeNull();
  });

  it("verifier が修正すると verified=modified", async () => {
    mockedCall.mockImplementation(
      dispatch("general", OK_JSON, SYNTH_TENSION, "修正済みの回答全文") as unknown as typeof callModel,
    );
    const { env } = makeEnv();

    const res = await runAnalyze(
      { input: "x", summary: "", plan: "light", clientId: "c1" },
      { env, now: new Date(), requestId: "req-5" },
    );

    expect(res.meta.verified).toBe("modified");
    expect(res.answer).toBe("修正済みの回答全文");
  });
});

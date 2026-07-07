import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/callModel.js", () => ({ callModel: vi.fn() }));

import { callModel } from "../src/lib/callModel.js";
import { runAnalyze } from "../src/lib/analyze.js";
import type { ModelRole } from "../src/config/models.js";
import type { ChatMessage, Env, ModelCallResult } from "../src/types.js";

const mockedCall = vi.mocked(callModel);

function result(text: string): ModelCallResult {
  return { text, inTok: 0, outTok: 0, ms: 0, estimated: false };
}
const OK_JSON = JSON.stringify({ points: ["論点"], confidence: 0.8, flag: null });

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

// role ごとに応答を返す標準モック
function dispatch(nodeText: string) {
  return (role: ModelRole, _messages: ChatMessage[]): Promise<ModelCallResult> => {
    switch (role) {
      case "router":
        return Promise.resolve(result("normal"));
      case "node":
        return Promise.resolve(result(nodeText));
      case "synth":
        return Promise.resolve(result("最終回答本文\n---SUMMARY---\n新しい要約"));
      case "verifier":
        return Promise.resolve(result("pass"));
      default:
        return Promise.resolve(result(""));
    }
  };
}

beforeEach(() => {
  mockedCall.mockReset();
});

describe("runAnalyze パイプライン", () => {
  it("正常系: 契約どおりの一括JSONを返す", async () => {
    mockedCall.mockImplementation(
      dispatch(OK_JSON) as unknown as typeof callModel,
    );
    const { env, store } = makeEnv();

    const res = await runAnalyze(
      { input: "テスト入力", summary: "", mode: "auto", clientId: "c1" },
      { env, now: new Date(), requestId: "req-1" },
    );

    expect(res.answer).toBe("最終回答本文");
    expect(res.summary).toBe("新しい要約");
    // normal = 4起動、全ok
    expect(res.nodes).toHaveLength(4);
    expect(res.nodes.every((n) => n.status === "ok")).toBe(true);
    expect(res.meta.route).toBe("normal");
    expect(res.meta.quorum).toBe("4/4");
    expect(res.meta.fallback).toBe(false);
    expect(res.meta.verified).toBe("pass");
    expect(typeof res.meta.totalCost).toBe("number");
    expect(typeof res.meta.ms).toBe("number");
    expect(res.meta.quotaUsed).toBe(1);

    // KV に cost レコードと quota が書かれている
    expect([...store.keys()].some((k) => k.startsWith("cost:"))).toBe(true);
    expect(store.get("quota:c1:" + ym(new Date()))).toBe("1");
  });

  it("クォーラム未達なら fallback で単発回答を返す", async () => {
    // ノードは全て壊れた出力 → 成功0 < quorum → fallback
    mockedCall.mockImplementation(
      dispatch("壊れた出力") as unknown as typeof callModel,
    );
    const { env } = makeEnv();

    const res = await runAnalyze(
      { input: "テスト入力", summary: "", mode: "auto", clientId: "c1" },
      { env, now: new Date(), requestId: "req-2" },
    );

    expect(res.meta.fallback).toBe(true);
    expect(res.answer).toBe("最終回答本文");
    // 起動ノードのstatusは含まれる (parse_error)
    expect(res.nodes).toHaveLength(4);
    expect(res.nodes.every((n) => n.status === "parse_error")).toBe(true);
  });

  it("mode 明示時は Router を呼ばない", async () => {
    mockedCall.mockImplementation(
      dispatch(OK_JSON) as unknown as typeof callModel,
    );
    const { env } = makeEnv();

    const res = await runAnalyze(
      { input: "x", summary: "", mode: "simple", clientId: "c1" },
      { env, now: new Date(), requestId: "req-3" },
    );

    expect(res.meta.route).toBe("simple");
    // router ロールでの呼び出しが無いこと
    const roles = mockedCall.mock.calls.map((c) => c[0]);
    expect(roles).not.toContain("router");
    // simple = compress, next の2起動
    expect(res.nodes).toHaveLength(2);
  });

  it("verifier が修正するとき verified=modified になる", async () => {
    mockedCall.mockImplementation(((role: ModelRole) => {
      if (role === "router") return Promise.resolve(result("normal"));
      if (role === "node") return Promise.resolve(result(OK_JSON));
      if (role === "synth")
        return Promise.resolve(result("回答\n---SUMMARY---\n要約"));
      return Promise.resolve(result("修正済みの回答全文"));
    }) as unknown as typeof callModel);
    const { env } = makeEnv();

    const res = await runAnalyze(
      { input: "x", summary: "", mode: "auto", clientId: "c1" },
      { env, now: new Date(), requestId: "req-4" },
    );

    expect(res.meta.verified).toBe("modified");
    expect(res.answer).toBe("修正済みの回答全文");
  });
});

function ym(d: Date): string {
  const m = d.getUTCMonth() + 1;
  return `${d.getUTCFullYear()}${m < 10 ? "0" + m : m}`;
}

import { afterEach, describe, expect, it, vi } from "vitest";
import { callModel } from "../src/lib/callModel.js";
import { callModelStream } from "../src/lib/callModelStream.js";
import { CostCollector } from "../src/lib/costlog.js";
import { resetCooldowns } from "../src/lib/providerHealth.js";
import type { ChatMessage, Env } from "../src/types.js";

// 1分あたりの上限(429)・障害(5xx)で主のプロバイダーが応答できないとき、
// もう一方(OpenAI ⇔ DeepSeek)へ切り替える。
const messages: ChatMessage[] = [
  { role: "system", content: "s" },
  { role: "user", content: "u" },
];
const both = { OCTO_KV: {} as KVNamespace, OPENAI_API_KEY: "o", DEEPSEEK_API_KEY: "d" } as Env;

function ok(text: string, headers: Record<string, string> = {}) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: text }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }),
    { status: 200, headers: { "content-type": "application/json", ...headers } },
  );
}

function route(handler: (url: string) => Response) {
  const fn = vi.fn(async (url: string | URL | Request) => handler(String(url)));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetCooldowns();
});

describe("プロバイダー切り替え(非ストリーム)", () => {
  it("OpenAI が 429 を返し続けたら DeepSeek で応答し、原価ログに fallback を残す", async () => {
    const fetch = route((url) =>
      url.includes("openai") ? new Response("rate limited", { status: 429 }) : ok("deepseek の回答"),
    );
    const col = new CostCollector();
    const r = await callModel("node", messages, { env: both, retryBaseMs: 0, collector: col });
    expect(r.text).toBe("deepseek の回答");
    // 切り替え先があるので、混雑(429)での同じ相手への再試行は1回まで(外部呼び出し回数を節約)
    expect(fetch.mock.calls.filter((c) => String(c[0]).includes("openai"))).toHaveLength(2);
    expect(col.calls[0]).toMatchObject({ model: "deepseek-flash", fallback: true });
  });

  it("400(入力不備)では切り替えない", async () => {
    route((url) => (url.includes("openai") ? new Response("bad", { status: 400 }) : ok("x")));
    await expect(callModel("node", messages, { env: both, retryBaseMs: 0 })).rejects.toThrow("HTTP 400");
  });

  it("切り替え先のキーが無い・MODEL_FALLBACK=off なら切り替えない", async () => {
    route((url) => (url.includes("openai") ? new Response("x", { status: 503 }) : ok("x")));
    const onlyOpenai = { OCTO_KV: {} as KVNamespace, OPENAI_API_KEY: "o" } as Env;
    await expect(callModel("node", messages, { env: onlyOpenai, retryBaseMs: 0 })).rejects.toThrow("HTTP 503");
    await expect(
      callModel("node", messages, { env: { ...both, MODEL_FALLBACK: "off" }, retryBaseMs: 0 }),
    ).rejects.toThrow("HTTP 503");
  });

  it("1分あたり上限の実測値(x-ratelimit-*)を原価ログに残す", async () => {
    route(() =>
      ok("x", {
        "x-ratelimit-limit-requests": "500",
        "x-ratelimit-remaining-requests": "499",
        "x-ratelimit-limit-tokens": "200000",
        "x-ratelimit-remaining-tokens": "199000",
      }),
    );
    const col = new CostCollector();
    await callModel("node", messages, { env: both, retryBaseMs: 0, collector: col });
    expect(col.calls[0].rl).toEqual({
      limitRequests: 500,
      remainingRequests: 499,
      limitTokens: 200000,
      remainingTokens: 199000,
    });
  });
});

describe("プロバイダー切り替え(ストリーム)", () => {
  it("開始時に 429 なら DeepSeek のストリームで開き直す", async () => {
    const sse =
      `data: ${JSON.stringify({ choices: [{ delta: { content: "続き" } }] })}\n\n` + "data: [DONE]\n\n";
    route((url) =>
      url.includes("openai")
        ? new Response("rate limited", { status: 429 })
        : new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } }),
    );
    const col = new CostCollector();
    let text = "";
    for await (const d of callModelStream("synth", messages, { env: both, collector: col })) text += d;
    expect(text).toBe("続き");
    expect(col.calls[0]).toMatchObject({ model: "deepseek-v4-pro", fallback: true });
  });
});

describe("無料枠(Groq・さくら)を有料の切り替え先より先に使う", () => {
  const all = { ...both, GROQ_API_KEY: "g", SAKURA_API_KEY: "s" } as Env;
  const busy = () => new Response("rate", { status: 429 });

  it("試す順は 無料枠(Groq → さくら)→ もう一方の有料構成。キーが無いものは除く", async () => {
    const { fallbackChain, modelFor } = await import("../src/config/models.js");
    const primary = modelFor("node", all);
    expect(fallbackChain("node", all, primary).map((c) => c.model)).toEqual(["openai/gpt-oss-20b", "gpt-oss-120b", "deepseek-flash"]);
    // 統合脳は大きいモデル
    expect(fallbackChain("synth", all, modelFor("synth", all))[0].model).toBe("openai/gpt-oss-120b");
    expect(fallbackChain("node", both, primary).map((c) => c.model)).toEqual(["deepseek-flash"]);
    expect(fallbackChain("node", { ...all, FREE_FALLBACK: "off" } as Env, primary).map((c) => c.model)).toEqual(["deepseek-flash"]);
    expect(fallbackChain("node", { ...all, MODEL_FALLBACK: "off" } as Env, primary)).toEqual([]);
  });

  it("OpenAI が混雑なら Groq で答え、原価0・切り替えとして記録する", async () => {
    const fetch = route((url) => (url.includes("openai.com") ? busy() : url.includes("groq") ? ok("groq の回答") : ok("x")));
    const col = new CostCollector();
    const r = await callModel("node", messages, { env: all, retryBaseMs: 0, collector: col });
    expect(r.text).toBe("groq の回答");
    expect(col.calls[0]).toMatchObject({ model: "openai/gpt-oss-20b", fallback: true, estCost: 0 });
    expect(fetch.mock.calls.some((c) => String(c[0]).includes("deepseek"))).toBe(false);
  });

  it("切り替え先の失敗は形式の違い(400)でも次の候補へ進み、再試行はしない", async () => {
    const fetch = route((url) =>
      url.includes("openai.com") ? busy() : url.includes("groq") ? new Response("bad", { status: 400 }) : url.includes("sakura") ? busy() : ok("deepseek の回答"));
    const r = await callModel("node", messages, { env: all, retryBaseMs: 0 });
    expect(r.text).toBe("deepseek の回答");
    expect(fetch.mock.calls.filter((c) => String(c[0]).includes("groq"))).toHaveLength(1);
    expect(fetch.mock.calls.filter((c) => String(c[0]).includes("sakura"))).toHaveLength(1);
  });

  it("混雑した相手はしばらく休ませ、次の呼び出しでは最初から飛ばす", async () => {
    const fetch = route((url) => (url.includes("openai.com") ? busy() : ok("groq")));
    await callModel("node", messages, { env: all, retryBaseMs: 0 });
    const before = fetch.mock.calls.filter((c) => String(c[0]).includes("openai.com")).length;
    await callModel("node", messages, { env: all, retryBaseMs: 0 });
    expect(fetch.mock.calls.filter((c) => String(c[0]).includes("openai.com")).length).toBe(before);
  });

  it("ストリームも開始時の混雑で Groq に開き直す", async () => {
    const sse = "data: " + JSON.stringify({ choices: [{ delta: { content: "groqの本文" } }] }) + "\n\ndata: [DONE]\n\n";
    route((url) => (url.includes("openai.com") ? busy() : new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } })));
    const col = new CostCollector();
    let text = "";
    for await (const t of callModelStream("synth", messages, { env: all, retryBaseMs: 0, collector: col })) text += t;
    expect(text).toBe("groqの本文");
    expect(col.calls[0]).toMatchObject({ model: "openai/gpt-oss-120b", fallback: true });
  });
});

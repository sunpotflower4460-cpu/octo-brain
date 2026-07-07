import { afterEach, describe, expect, it, vi } from "vitest";
import { callModel } from "../src/lib/callModel.js";
import type { ModelConfig } from "../src/config/models.js";
import type { ChatMessage, Env } from "../src/types.js";

const messages: ChatMessage[] = [
  { role: "system", content: "system-rule" },
  { role: "user", content: "hello" },
];

const env: Env = {
  OCTO_KV: {} as KVNamespace,
  DEEPSEEK_API_KEY: "test-openai-key",
  GEMINI_API_KEY: "gm-test-key",
  ANTHROPIC_API_KEY: "an-test-key",
};

const openaiCfg: ModelConfig = {
  provider: "openai-compat",
  baseURL: "https://api.example.com/v1",
  model: "test-chat",
  maxTokens: 250,
  keyEnv: "DEEPSEEK_API_KEY",
  pricePerMTokIn: 0,
  pricePerMTokOut: 0,
};

const geminiCfg: ModelConfig = {
  provider: "gemini",
  model: "gemini-test",
  maxTokens: 250,
  keyEnv: "GEMINI_API_KEY",
  pricePerMTokIn: 0,
  pricePerMTokOut: 0,
};

const anthropicCfg: ModelConfig = {
  provider: "anthropic",
  model: "claude-test",
  maxTokens: 250,
  keyEnv: "ANTHROPIC_API_KEY",
  pricePerMTokIn: 0,
  pricePerMTokOut: 0,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockFetch(impl: (url: string, init: RequestInit) => Response) {
  const fn = vi.fn((url: string | URL | Request, init?: RequestInit) =>
    Promise.resolve(impl(String(url), init ?? {})),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

function bodyOf(init: RequestInit): Record<string, unknown> {
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("openai-compat", () => {
  it("正しいURL/ヘッダ/ボディに変換し usage を取得する", async () => {
    const fetchMock = mockFetch(() =>
      jsonResponse({
        choices: [{ message: { content: "hi" } }],
        usage: { prompt_tokens: 12, completion_tokens: 3 },
      }),
    );

    const res = await callModel("node", messages, {
      env,
      modelOverride: openaiCfg,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.example.com/v1/chat/completions");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer test-openai-key");
    const body = bodyOf(init);
    expect(body.model).toBe("test-chat");
    expect(body.max_tokens).toBe(250);
    expect(body.messages).toEqual([
      { role: "system", content: "system-rule" },
      { role: "user", content: "hello" },
    ]);

    expect(res.text).toBe("hi");
    expect(res.inTok).toBe(12);
    expect(res.outTok).toBe(3);
    expect(res.estimated).toBe(false);
  });

  it("opts.maxTokens が API リクエストに反映される", async () => {
    const fetchMock = mockFetch(() =>
      jsonResponse({ choices: [{ message: { content: "x" } }], usage: {} }),
    );

    await callModel("node", messages, {
      env,
      modelOverride: openaiCfg,
      maxTokens: 42,
    });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(bodyOf(init).max_tokens).toBe(42);
  });

  it("usage が無ければ 文字数/4 で概算し estimated:true", async () => {
    mockFetch(() => jsonResponse({ choices: [{ message: { content: "abcd" } }] }));

    const res = await callModel("node", messages, {
      env,
      modelOverride: openaiCfg,
    });

    // 入力 = "system-rule"+"hello" = 16文字 → ceil(16/4)=4, 出力 "abcd"=4文字 → 1
    expect(res.estimated).toBe(true);
    expect(res.inTok).toBe(4);
    expect(res.outTok).toBe(1);
  });
});

describe("gemini", () => {
  it("systemInstruction / contents / maxOutputTokens 形式に変換する", async () => {
    const fetchMock = mockFetch(() =>
      jsonResponse({
        candidates: [{ content: { parts: [{ text: "g-out" }] } }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 },
      }),
    );

    const res = await callModel("router", messages, {
      env,
      modelOverride: geminiCfg,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(
      "/models/gemini-test:generateContent?key=gm-test-key",
    );
    const body = bodyOf(init);
    expect(body.systemInstruction).toEqual({
      parts: [{ text: "system-rule" }],
    });
    expect(body.contents).toEqual([
      { role: "user", parts: [{ text: "hello" }] },
    ]);
    expect(body.generationConfig).toEqual({ maxOutputTokens: 250 });

    expect(res.text).toBe("g-out");
    expect(res.inTok).toBe(5);
    expect(res.outTok).toBe(2);
    expect(res.estimated).toBe(false);
  });
});

describe("anthropic", () => {
  it("/v1/messages 形式・x-api-key・system 分離に変換する", async () => {
    const fetchMock = mockFetch(() =>
      jsonResponse({
        content: [{ type: "text", text: "a-out" }],
        usage: { input_tokens: 7, output_tokens: 4 },
      }),
    );

    const res = await callModel("synth", messages, {
      env,
      modelOverride: anthropicCfg,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("an-test-key");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    const body = bodyOf(init);
    expect(body.system).toBe("system-rule");
    expect(body.max_tokens).toBe(250);
    expect(body.messages).toEqual([{ role: "user", content: "hello" }]);

    expect(res.text).toBe("a-out");
    expect(res.inTok).toBe(7);
    expect(res.outTok).toBe(4);
  });
});

describe("リトライ", () => {
  it("429 のあと 200 なら成功する (最大2回)", async () => {
    let calls = 0;
    const fetchMock = mockFetch(() => {
      calls++;
      if (calls === 1) return jsonResponse({ error: "rate" }, 429);
      return jsonResponse({
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });
    });

    const res = await callModel("node", messages, {
      env,
      modelOverride: openaiCfg,
      retryBaseMs: 0,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.text).toBe("ok");
  });

  it("5xx が続くと最終的にエラーを投げる", async () => {
    mockFetch(() => jsonResponse({ error: "boom" }, 500));

    await expect(
      callModel("node", messages, {
        env,
        modelOverride: openaiCfg,
        retryBaseMs: 0,
      }),
    ).rejects.toThrow(/HTTP 500/);
  });
});

describe("AbortSignal", () => {
  it("既に abort されている signal では中断される", async () => {
    mockFetch(() =>
      jsonResponse({ choices: [{ message: { content: "never" } }] }),
    );
    const ac = new AbortController();
    ac.abort();

    await expect(
      callModel("node", messages, {
        env,
        modelOverride: openaiCfg,
        signal: ac.signal,
      }),
    ).rejects.toThrow(/abort/i);
  });

  it("バックオフ待機中に abort されると中断される", async () => {
    const ac = new AbortController();
    mockFetch(() => {
      // 最初の呼び出しで abort をトリガーし、429 を返してバックオフに入らせる
      ac.abort();
      return jsonResponse({ error: "rate" }, 429);
    });

    await expect(
      callModel("node", messages, {
        env,
        modelOverride: openaiCfg,
        signal: ac.signal,
        retryBaseMs: 1000,
      }),
    ).rejects.toThrow(/abort/i);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/callModel.js", () => ({ callModel: vi.fn() }));

import { callModel } from "../src/lib/callModel.js";
import { parseNodeResponse, runNodes } from "../src/lib/runNodes.js";
import { NODE_DEFS, type NodeId } from "../src/config/nodes.js";
import type { ChatMessage, Env, ModelCallResult } from "../src/types.js";

const mockedCall = vi.mocked(callModel);
const env: Env = { OCTO_KV: {} as KVNamespace, DEEPSEEK_API_KEY: "k" };

function result(text: string): ModelCallResult {
  return { text, inTok: 0, outTok: 0, ms: 0, estimated: false };
}
const OK_JSON = JSON.stringify({ points: ["ある論点"], confidence: 0.8, flag: null });

// system プロンプトの verb からノードidを逆引き (テスト用)
function idOf(messages: ChatMessage[]): NodeId | undefined {
  const sys = messages[0]?.content ?? "";
  return NODE_DEFS.find((d) => sys.includes(d.verb))?.id;
}

beforeEach(() => {
  mockedCall.mockReset();
});

describe("parseNodeResponse", () => {
  it("正常JSONを ok として正規化する", () => {
    const r = parseNodeResponse(
      "counter",
      JSON.stringify({ points: ["a", "b"], confidence: 0.9, flag: null }),
    );
    expect(r.status).toBe("ok");
    expect(r.points).toEqual(["a", "b"]);
    expect(r.confidence).toBe(0.9);
  });

  it("前後にゴミがある壊れたJSONでも {...} 抽出で復旧する", () => {
    const raw = 'ここに前置き {"points":["x"],"confidence":0.5,"flag":null} おまけ';
    const r = parseNodeResponse("gaps", raw);
    expect(r.status).toBe("ok");
    expect(r.points).toEqual(["x"]);
  });

  it("抽出も不能なら parse_error", () => {
    const r = parseNodeResponse("gaps", "まったくJSONではない文字列");
    expect(r.status).toBe("parse_error");
    expect(r.points).toEqual([]);
  });

  it("points は最大3・各60字に切り詰め、confidence はクランプ", () => {
    const long = "あ".repeat(80);
    const r = parseNodeResponse(
      "worst",
      JSON.stringify({
        points: [long, "b", "c", "d"],
        confidence: 5,
        flag: "off_topic",
      }),
    );
    expect(r.points).toHaveLength(3);
    expect(r.points[0].length).toBe(60);
    expect(r.confidence).toBe(1);
    expect(r.flag).toBe("off_topic");
  });

  it("不正な flag は null に正規化", () => {
    const r = parseNodeResponse(
      "next",
      JSON.stringify({ points: ["x"], confidence: 0.3, flag: "bogus" }),
    );
    expect(r.flag).toBeNull();
  });
});

describe("runNodes クォーラム", () => {
  it("complex 8起動で5成功なら続行 (fallback=false)", async () => {
    // 先頭5ノードは正常、残り3ノードは壊れたJSON
    const good = new Set<NodeId>([
      "assumptions",
      "counter",
      "gaps",
      "options",
      "worst",
    ]);
    mockedCall.mockImplementation(async (_role, messages) => {
      const id = idOf(messages as ChatMessage[]);
      return result(id && good.has(id) ? OK_JSON : "壊れた出力");
    });

    const run = await runNodes("complex", "入力", "", { env });
    expect(run.nodes).toHaveLength(8);
    expect(run.successCount).toBe(5);
    expect(run.required).toBe(5);
    expect(run.fallback).toBe(false);
  });

  it("complex 8起動で4成功ならクォーラム未達 (fallback=true)", async () => {
    const good = new Set<NodeId>(["assumptions", "counter", "gaps", "options"]);
    mockedCall.mockImplementation(async (_role, messages) => {
      const id = idOf(messages as ChatMessage[]);
      return result(id && good.has(id) ? OK_JSON : "壊れた出力");
    });

    const run = await runNodes("complex", "入力", "", { env });
    expect(run.successCount).toBe(4);
    expect(run.fallback).toBe(true);
  });
});

describe("runNodes タイムアウト", () => {
  it("1ノードがタイムアウトしても全体は止まらず timeout 扱いになる", async () => {
    mockedCall.mockImplementation((_role, messages, opts) => {
      const id = idOf(messages as ChatMessage[]);
      if (id === "counter") {
        // signal が abort されるまで解決しないノード
        return new Promise<ModelCallResult>((_res, reject) => {
          opts?.signal?.addEventListener("abort", () => {
            const e = new Error("aborted");
            e.name = "AbortError";
            reject(e);
          });
        });
      }
      return Promise.resolve(result(OK_JSON));
    });

    // normal = assumptions, counter, options, next (quorum 3)
    const run = await runNodes("normal", "入力", "", {
      env,
      nodeTimeoutMs: 20,
    });

    const counter = run.nodes.find((n) => n.id === "counter");
    expect(counter?.status).toBe("timeout");
    // 残り3ノードは成功 → クォーラム達成、回答は続行できる
    expect(run.successCount).toBe(3);
    expect(run.fallback).toBe(false);
  });
});

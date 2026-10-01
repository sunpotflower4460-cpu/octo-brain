import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/callModel.js", () => ({ callModel: vi.fn() }));

import { callModel } from "../src/lib/callModel.js";
import { parseNodeResponse, runNodes } from "../src/lib/runNodes.js";
import { ALL_LENS_IDS, NODE_DEFS, type NodeId } from "../src/config/nodes.js";
import type { ChatMessage, Env, ModelCallResult } from "../src/types.js";

const mockedCall = vi.mocked(callModel);
const env: Env = { OCTO_KV: {} as KVNamespace, DEEPSEEK_API_KEY: "k" };

function result(text: string): ModelCallResult {
  return { text, inTok: 0, outTok: 0, ms: 0, estimated: false };
}
const OK_JSON = JSON.stringify({
  opinions: [{ claim: "ある論点", weight: 0.8, why: "その理由" }],
  flag: null,
});

// user メッセージ先頭の担当(verb)からレンズidを逆引き (テスト用)。
// system は全腕共通(キャッシュのため)なので、担当は user 側にある
function idOf(messages: ChatMessage[]): NodeId | undefined {
  const user = messages[1]?.content ?? "";
  return NODE_DEFS.find((d) => user.startsWith(`[あなたの担当]\n${d.verb}`))?.id;
}

beforeEach(() => {
  mockedCall.mockReset();
});

describe("parseNodeResponse (opinions)", () => {
  it("正常JSONを ok として正規化する", () => {
    const r = parseNodeResponse(
      "reason",
      JSON.stringify({
        opinions: [
          { claim: "a", weight: 0.9, why: "wa" },
          { claim: "b", weight: 0.5, why: "wb" },
        ],
        flag: null,
      }),
    );
    expect(r.status).toBe("ok");
    expect(r.opinions).toHaveLength(2);
    expect(r.opinions[0]).toEqual({ claim: "a", weight: 0.9, why: "wa" });
  });

  it("前後にゴミがある壊れたJSONでも {...} 抽出で復旧する", () => {
    const raw =
      'まえおき {"opinions":[{"claim":"x","weight":0.5,"why":"y"}],"flag":null} おまけ';
    const r = parseNodeResponse("risk", raw);
    expect(r.status).toBe("ok");
    expect(r.opinions[0].claim).toBe("x");
  });

  it("抽出も不能なら parse_error", () => {
    const r = parseNodeResponse("risk", "まったくJSONではない文字列");
    expect(r.status).toBe("parse_error");
    expect(r.opinions).toEqual([]);
  });

  it("opinions は最大3・claim/why 60字に切り詰め・weight クランプ", () => {
    const long = "あ".repeat(80);
    const r = parseNodeResponse(
      "future",
      JSON.stringify({
        opinions: [
          { claim: long, weight: 5, why: long },
          { claim: "b", weight: -1, why: "wb" },
          { claim: "c", weight: 0.3, why: "wc" },
          { claim: "d", weight: 0.4, why: "wd" },
        ],
        flag: "off_topic",
      }),
    );
    expect(r.opinions).toHaveLength(3);
    expect(r.opinions[0].claim.length).toBe(60);
    expect(r.opinions[0].weight).toBe(1);
    expect(r.opinions[1].weight).toBe(0);
    expect(r.flag).toBe("off_topic");
  });

  it("claim を持たない不正要素は除去、weight欠落は中立0.5", () => {
    const r = parseNodeResponse(
      "step",
      JSON.stringify({
        opinions: [
          { weight: 0.9, why: "claimなし" },
          { claim: "有効", why: "weightなし" },
          "文字列要素",
        ],
        flag: null,
      }),
    );
    expect(r.opinions).toHaveLength(1);
    expect(r.opinions[0].claim).toBe("有効");
    expect(r.opinions[0].weight).toBe(0.5);
  });

  it("不正な flag は null に正規化", () => {
    const r = parseNodeResponse(
      "values",
      JSON.stringify({ opinions: [{ claim: "x", weight: 0.3, why: "y" }], flag: "bogus" }),
    );
    expect(r.flag).toBeNull();
  });
});

describe("runNodes クォーラム", () => {
  it("8腕で5成功なら続行 (required=4, fallback=false)", async () => {
    const good = new Set<NodeId>(ALL_LENS_IDS.slice(0, 5));
    mockedCall.mockImplementation(async (_role, messages) => {
      const id = idOf(messages as ChatMessage[]);
      return result(id && good.has(id) ? OK_JSON : "壊れた出力");
    });

    const run = await runNodes(ALL_LENS_IDS, 4, "入力", "", { env });
    expect(run.nodes).toHaveLength(8);
    expect(run.successCount).toBe(5);
    expect(run.required).toBe(4);
    expect(run.fallback).toBe(false);
  });

  it("8腕で3成功ならクォーラム未達 (fallback=true)", async () => {
    const good = new Set<NodeId>(ALL_LENS_IDS.slice(0, 3));
    mockedCall.mockImplementation(async (_role, messages) => {
      const id = idOf(messages as ChatMessage[]);
      return result(id && good.has(id) ? OK_JSON : "壊れた出力");
    });

    const run = await runNodes(ALL_LENS_IDS, 4, "入力", "", { env });
    expect(run.successCount).toBe(3);
    expect(run.fallback).toBe(true);
  });

  it("flag付き・空opinions は成功に数えない(統合除外と一致)", async () => {
    const EMPTY = JSON.stringify({ opinions: [], flag: "insufficient_input" });
    const FLAGGED = JSON.stringify({
      opinions: [{ claim: "外れ", weight: 0.9, why: "無関係" }],
      flag: "off_topic",
    });
    mockedCall.mockImplementation(async (_role, messages) => {
      const id = idOf(messages as ChatMessage[]);
      if (id === "reason" || id === "emotion" || id === "risk") return result(OK_JSON);
      if (id === "empathy") return result(EMPTY);
      return result(FLAGGED);
    });

    const run = await runNodes(ALL_LENS_IDS, 4, "入力", "", { env });
    // 実質使えるのは3件のみ → required=4 で fallback
    expect(run.successCount).toBe(3);
    expect(run.fallback).toBe(true);
    expect(run.nodes.find((n) => n.id === "empathy")?.flag).toBe("insufficient_input");
    expect(run.nodes.find((n) => n.id === "future")?.flag).toBe("off_topic");
  });
});

describe("runNodes タイムアウト", () => {
  it("1腕がタイムアウトしても全体は止まらず timeout 扱いになる", async () => {
    const lenses: NodeId[] = ["emotion", "truth", "risk", "step"];
    mockedCall.mockImplementation((_role, messages, opts) => {
      const id = idOf(messages as ChatMessage[]);
      if (id === "truth") {
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

    const run = await runNodes(lenses, 2, "入力", "", { env, nodeTimeoutMs: 20 });

    const truth = run.nodes.find((n) => n.id === "truth");
    expect(truth?.status).toBe("timeout");
    expect(run.successCount).toBe(3);
    expect(run.fallback).toBe(false);
  });
});

describe("腕の共有システムプロンプト(キャッシュ)", () => {
  it("全腕で system が同じで、担当は user の先頭に置く", async () => {
    const { runNodes } = await import("../src/lib/runNodes.js");
    mockedCall.mockImplementation(((_r: unknown, _m: ChatMessage[]) =>
      Promise.resolve({ text: JSON.stringify({ opinions: [{ claim: "c", weight: 0.8, why: "w" }], flag: null }), inTok: 0, outTok: 0, ms: 0, estimated: false })) as never);
    await runNodes(NODE_DEFS.map((d) => d.id), 4, "入力", "", { env: {} as never });
    const calls = mockedCall.mock.calls.map((c) => c[1] as ChatMessage[]);
    expect(new Set(calls.map((m) => m[0].content)).size).toBe(1);
    // 他の担当の一覧(重ならないように)も共有部に入っている
    expect(NODE_DEFS.every((d) => calls[0][0].content.includes(d.verb))).toBe(true);
    expect(calls.map(idOf)).toEqual(NODE_DEFS.map((d) => d.id));
  });
});

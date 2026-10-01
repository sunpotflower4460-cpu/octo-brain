import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/callModel.js", () => ({ callModel: vi.fn() }));
vi.mock("../src/lib/callModelStream.js", () => ({ callModelStream: vi.fn() }));

import { callModel } from "../src/lib/callModel.js";
import { runAnalyze } from "../src/lib/analyze.js";
import { parseMode } from "../src/lib/worlds.js";
import { parseNodeResponse, withMaterials } from "../src/lib/runNodes.js";
import { mapperItems } from "../src/lib/mapper.js";
import { buildReports, buildSynthUserText, checkDirective, researchBlock, worldsDirective } from "../src/lib/synthesize.js";
import type { ModelRole } from "../src/config/models.js";
import type { ChatMessage, Env, ModelCallResult, NodeResult } from "../src/types.js";

const mockedCall = vi.mocked(callModel);
const result = (text: string): ModelCallResult => ({ text, inTok: 0, outTok: 0, ms: 0, estimated: false });

function makeEnv(extra: Record<string, string> = {}): Env {
  const store = new Map<string, string>();
  const kv = {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => void store.set(k, v),
  } as unknown as KVNamespace;
  return { OCTO_KV: kv, DEEPSEEK_API_KEY: "k", WORLDS: "on", ...extra };
}

beforeEach(() => mockedCall.mockReset());
afterEach(() => vi.unstubAllGlobals());

describe("探求のしかた(mode)", () => {
  it("check のときだけ照合、読めなければ explore", () => {
    expect(parseMode('{"mode":"check","worlds":[]}')).toBe("check");
    expect(parseMode('{"mode": "explore"}')).toBe("explore");
    expect(parseMode("壊れた出力")).toBe("explore");
  });
});

describe("腕の一手と照合", () => {
  it("世界つきの腕は具体的な一手(move)を返す", () => {
    const n = parseNodeResponse(
      "step",
      JSON.stringify({ experience: "e", move: "月の売上が30万円を3か月下回ったら撤退と決める", opinions: [{ claim: "c", weight: 0.8, why: "w" }], flag: null }),
      { name: "登山ガイド", daily: "" },
    );
    expect(n.move).toBe("月の売上が30万円を3か月下回ったら撤退と決める");
  });
  it("照合モードの腕は事実を最大3件・手順を返す(世界なし)", () => {
    const n = parseNodeResponse(
      "risk",
      JSON.stringify({ facts: [1, 2, 3, 4].map((i) => ({ text: `事実${i}`, sure: 0.9 })), move: "書面で確認する", opinions: [], flag: null }),
      null,
      true,
    );
    expect(n.facts?.map((f) => f.text)).toEqual(["事実1", "事実2", "事実3"]);
    expect(n.move).toBe("書面で確認する");
    expect(n.world).toBeUndefined();
  });
  it("照合モードの腕には、同じ資料を見せる", () => {
    const t = withMaterials("[入力]\n質問", [{ kind: "law", title: "民法 第627条", url: "u", text: "2週間で終了" }]);
    expect(t).toContain("[調べて確かめた資料]\n[S1] 民法 第627条: 2週間で終了");
    expect(withMaterials("x", [])).toBe("x");
  });
});

describe("照合の地図と統合", () => {
  const nodes: NodeResult[] = ["reason", "risk", "step"].map((id) => ({
    id,
    status: "ok",
    opinions: [{ claim: `${id}の意見`, weight: 0.8, why: "w" }],
    flag: null,
    facts: [{ text: `${id}の事実`, sure: 0.9 }],
    move: `${id}の手順`,
  }));
  it("照合モードの地図には、確かめた事実も並べる", () => {
    expect(mapperItems(nodes, true).map((i) => i.claim)).toEqual([
      "reasonの事実", "reasonの意見", "riskの事実", "riskの意見", "stepの事実", "stepの意見",
    ]);
    expect(mapperItems(nodes).map((i) => i.claim)).toEqual(["reasonの意見", "riskの意見", "stepの意見"]);
  });
  it("照合モードの統合指示: 一致した事実・資料での判定・条件の漏れない列挙・手順", () => {
    const text = buildSynthUserText("有給はもらえる?", "", buildReports(nodes), { check: true });
    expect(text).toContain("[照合]");
    expect(text).toContain("確認が必要");
    expect(text).not.toContain("[世界をまたぐ探求]");
    expect(text).toContain('"move":"reasonの手順"');
    expect(checkDirective(buildReports(nodes.slice(0, 1)))).toBeNull();
    // 評価で Sol に負けた点: 数字は表で、状況による分かれ目を示し、当てはまる方を確かめる
    expect(text).toContain("表(Markdown)");
    expect(text).toContain("分かれ目ごとに答え");
  });
  it("探求モードでは、違う世界の一手から行動を選ばせる", () => {
    const w = nodes.map((n, i) => ({ ...n, world: ["登山ガイド", "落語家", "救急医"][i], experience: "e" }));
    expect(worldsDirective(buildReports(w))).toContain("move");
  });
});

describe("資料の扱い", () => {
  it("資料を相談者が示したもののように書かせない", () => {
    expect(researchBlock([{ kind: "wiki", title: "有給休暇(Wikipedia)", url: "u", text: "t" }])).toContain("「ご提示の」");
  });
});

describe("パイプライン(照合モード)", () => {
  const PLAN = JSON.stringify({ mode: "check", worlds: [{ name: "使われない世界", daily: "" }], research: { laws: [], topics: ["有給休暇"], web: [] } });
  function dispatch(calls: { role: ModelRole; messages: ChatMessage[] }[]) {
    return ((role: ModelRole, messages: ChatMessage[]) => {
      calls.push({ role, messages });
      const t: Partial<Record<ModelRole, string>> = {
        router: "work",
        worlds: PLAN,
        node: JSON.stringify({ facts: [{ text: "6か月・8割で付与", sure: 0.9 }], move: "書面で確認", opinions: [{ claim: "c", weight: 0.8, why: "w" }], flag: null }),
        synth: '有給休暇はあります。\n---TENSION--- {"axis":"時の軸","reason":"r"}\n---SUMMARY---\n要約',
        verifier: "pass",
        mapper: '{"agree":{"point":"6か月・8割で付与","ids":[1,3,5]},"split":null,"lone":null,"essence":null}',
      };
      return Promise.resolve(result(t[role] ?? "{}"));
    }) as unknown as typeof callModel;
  }

  it("資料を腕にも見せ、全腕が照合の指示で確かめ、地図と統合も照合になる", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ query: { pages: [{ title: "有給休暇", extract: "6か月継続・8割出勤で付与", fullurl: "https://ja.wikipedia.org/wiki/x" }] } }), { status: 200 })));
    const calls: { role: ModelRole; messages: ChatMessage[] }[] = [];
    mockedCall.mockImplementation(dispatch(calls));
    const res = await runAnalyze(
      { input: "パートでも有給はもらえる?", summary: "", plan: "light", clientId: "c1" },
      { env: makeEnv(), now: new Date(), requestId: "r" },
    );
    const nodeCalls = calls.filter((c) => c.role === "node");
    expect(nodeCalls).toHaveLength(4);
    expect(nodeCalls.every((c) => c.messages[0].content.includes("独立した確認役"))).toBe(true);
    expect(nodeCalls.every((c) => c.messages[1].content.includes("[調べて確かめた資料]"))).toBe(true);
    // 照合モードでは世界を立てない(モデルが返しても使わない)
    expect(nodeCalls.some((c) => c.messages[1].content.includes("[あなたの世界]"))).toBe(false);
    expect(calls.find((c) => c.role === "mapper")!.messages[0].content).toContain("照合の地図");
    expect(calls.find((c) => c.role === "synth")!.messages[1].content).toContain("[照合]");
    expect(res.meta.inquiry).toBe("check");
    expect(res.meta.map?.agree?.point).toBe("6か月・8割で付与");
    expect(res.nodes[0].move).toBe("書面で確認");
  });
});

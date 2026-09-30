import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/callModel.js", () => ({ callModel: vi.fn() }));
vi.mock("../src/lib/callModelStream.js", () => ({ callModelStream: vi.fn() }));

import { callModel } from "../src/lib/callModel.js";
import { planWorldCount, runAnalyze } from "../src/lib/analyze.js";
import { planLenses } from "../src/config/nodes.js";
import { parseWorlds, WORLD_COUNT } from "../src/lib/worlds.js";
import { parseNodeResponse, withWorld } from "../src/lib/runNodes.js";
import { buildReports, buildSynthUserText, worldsDirective } from "../src/lib/synthesize.js";
import { mapperExperiences, parseMapperOutput, mapperItems, salvageSections } from "../src/lib/mapper.js";
import type { ModelRole } from "../src/config/models.js";
import type { ChatMessage, Env, ModelCallResult, NodeResult } from "../src/types.js";

const mockedCall = vi.mocked(callModel);
const result = (text: string): ModelCallResult => ({ text, inTok: 0, outTok: 0, ms: 0, estimated: false });

const WORLDS_JSON = JSON.stringify({
  worlds: [
    { name: "登山ガイド", daily: "出発前に撤退の時刻を決める" },
    { name: "落語家", daily: "短い高座で客の反応を確かめる" },
    { name: "救急医", daily: "取り返しのつかない危険から先に除く" },
    { name: "農家", daily: "不作の年は土と天候から見直す" },
    { name: "宮大工", daily: "任される範囲が広がるかで修業先を見る" },
    { name: "将棋の棋士", daily: "形勢が悪いときの粘り方を決めておく" },
    { name: "保育士", daily: "急な休みにも回る体制を先に作る" },
    { name: "外交官", daily: "相手の意図を決めつけず確かめる" },
  ],
});
const WORLD_NODE = JSON.stringify({
  experience: "登山の世界では、出発前に撤退の時刻を決めておく。",
  facts: [{ text: "在職中の転職活動は一般的", sure: 0.9 }, { text: "", sure: 1 }, { text: "三つ目", sure: 2 }],
  opinions: [{ claim: "期限を先に決める", weight: 0.8, why: "迷いが続くから" }],
  flag: null,
});
const SYNTH = '回答本文\n---TENSION--- {"axis":"時の軸","reason":"r"}\n---SUMMARY---\n要約';

function makeEnv(extra: Record<string, string> = {}): Env {
  const store = new Map<string, string>();
  const kv = {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => void store.set(k, v),
  } as unknown as KVNamespace;
  return { OCTO_KV: kv, DEEPSEEK_API_KEY: "k", ...extra };
}

beforeEach(() => mockedCall.mockReset());

describe("世界の選定(worlds)", () => {
  it("名前の重複・空を除き、最大8つまで取り出す", () => {
    const raw = JSON.stringify({
      worlds: [{ name: "農家", daily: "d" }, { name: "農家", daily: "x" }, { name: "", daily: "y" }, ...Array.from({ length: 10 }, (_, i) => ({ name: `w${i}`, daily: "d" }))],
    });
    const w = parseWorlds(raw);
    expect(w?.[0]).toEqual({ name: "農家", daily: "d" });
    expect(w).toHaveLength(WORLD_COUNT);
  });
  it("空配列は「世界を立てない」、壊れた出力は null", () => {
    expect(parseWorlds('{"worlds":[]}')).toEqual([]);
    expect(parseWorlds("世界は選べません")).toBeNull();
  });
});

describe("世界つきの腕", () => {
  it("user メッセージの先頭に世界と日常を置く", () => {
    const t = withWorld("[入力]\n相談", { name: "登山ガイド", daily: "撤退の時刻を決める" });
    expect(t.startsWith("[あなたの世界]\n登山ガイド")).toBe(true);
    expect(t).toContain("撤退の時刻を決める");
    expect(t).toContain("[入力]\n相談");
  });
  it("経験と情報を取り出す(空の情報は捨て、確からしさは0〜1、最大2件)", () => {
    const n = parseNodeResponse("reason", WORLD_NODE, { name: "登山ガイド", daily: "" });
    expect(n.world).toBe("登山ガイド");
    expect(n.experience).toContain("撤退の時刻");
    expect(n.facts).toEqual([{ text: "在職中の転職活動は一般的", sure: 0.9 }, { text: "三つ目", sure: 1 }]);
    expect(n.opinions).toHaveLength(1);
  });
  it("世界なしなら従来どおり(経験・情報は付けない)", () => {
    const n = parseNodeResponse("reason", WORLD_NODE);
    expect(n.world).toBeUndefined();
    expect(n.experience).toBeUndefined();
    expect(n.facts).toBeUndefined();
  });
});

describe("統合脳への受け渡し", () => {
  const worldNodes: NodeResult[] = ["reason", "future", "risk"].map((id, i) => ({
    id,
    status: "ok",
    opinions: [{ claim: `c${i}`, weight: 0.8, why: "w" }],
    flag: null,
    world: ["登山ガイド", "落語家", "救急医"][i],
    experience: `経験${i}`,
    facts: [{ text: `情報${i}`, sure: 0.7 }],
  }));
  it("世界・経験・情報を報告に含め、世界をまたぐ本質を芯にする指示を添える", () => {
    const text = buildSynthUserText("相談", "", buildReports(worldNodes));
    expect(text).toContain("[世界をまたぐ探求]");
    expect(text).toContain("登山ガイド、落語家、救急医");
    expect(text).toContain('"experience":"経験0"');
    expect(text).toContain('"facts":[{"text":"情報0","sure":0.7}]');
  });
  it("世界が3つ未満なら指示を添えない", () => {
    expect(worldsDirective(buildReports(worldNodes.slice(0, 2)))).toBeNull();
    expect(buildSynthUserText("相談", "", buildReports(worldNodes.map((n) => ({ ...n, world: undefined, experience: undefined }))))).not.toContain("[世界をまたぐ探求]");
  });
  it("地図の本質は、3つ以上の別々の世界の経験を番号で確かめて返す", () => {
    const items = mapperItems(worldNodes);
    const exps = mapperExperiences(worldNodes);
    const m = parseMapperOutput('{"agree":null,"split":null,"lone":null,"essence":{"point":"先に基準を決める","worlds":[1,2,3,9]}}', items, exps);
    expect(m?.essence).toEqual({ point: "先に基準を決める", lenses: ["reason", "future", "risk"], worlds: ["登山ガイド", "落語家", "救急医"] });
    expect(parseMapperOutput('{"essence":{"point":"x","worlds":[1,1,2]}}', items, exps)).toBeNull();
  });
});

describe("壊れた地図 JSON の救出(実際に起きた出力)", () => {
  it("lone の中に余計なキーが入って括弧が崩れても、各部分を拾う", () => {
    const raw =
      '{"agree":{"point":"期限を定めて判断材料を集める。","ids":[1,4,7,8]},"split":null,"lone":{"id":3,"why":"話しづらさに左右される。","lone":null,"essence":{"point":"先に見直しの期限を設ける。","worlds":[1,2,3,4]}}';
    const o = salvageSections(raw);
    expect(o.agree).toEqual({ point: "期限を定めて判断材料を集める。", ids: [1, 4, 7, 8] });
    expect(o.split).toBeNull();
    expect(o.lone).toMatchObject({ id: 3, why: "話しづらさに左右される。" });
    expect(o.essence).toEqual({ point: "先に見直しの期限を設ける。", worlds: [1, 2, 3, 4] });
  });
  it("文字列の途中で括弧が壊れても、読める部分は使う", () => {
    const raw =
      '{"agree":{"point":"書面で合意する。","ids":[1,5,7,10]},"split":null,"lone":{"id":8,"why":"持分が残るおそれ。"," },"essence":{"point":"関係が変わる前に明確にする。","worlds":[1,2,3,4]}}';
    const o = salvageSections(raw);
    expect(o.lone).toMatchObject({ id: 8, why: "持分が残るおそれ。" });
    expect((o.essence as { worlds: number[] }).worlds).toEqual([1, 2, 3, 4]);
  });
});

describe("パイプライン(WORLDS=on)", () => {
  function dispatch(calls: { role: ModelRole; messages: ChatMessage[] }[]) {
    return ((role: ModelRole, messages: ChatMessage[]) => {
      calls.push({ role, messages });
      switch (role) {
        case "router": return Promise.resolve(result("work"));
        case "worlds": return Promise.resolve(result(WORLDS_JSON));
        case "node": return Promise.resolve(result(WORLD_NODE));
        case "synth": return Promise.resolve(result(SYNTH));
        case "verifier": return Promise.resolve(result("pass"));
        default: return Promise.resolve(result("{}"));
      }
    }) as unknown as typeof callModel;
  }

  it("世界を選び、腕ごとに別の世界で探求させ、ノードの見え方に世界を載せる", async () => {
    const calls: { role: ModelRole; messages: ChatMessage[] }[] = [];
    mockedCall.mockImplementation(dispatch(calls));
    const res = await runAnalyze(
      { input: "転職すべきか迷っている", summary: "", plan: "deep", clientId: "c1" },
      { env: makeEnv({ WORLDS: "on" }), now: new Date(), requestId: "r" },
    );
    expect(calls.filter((c) => c.role === "worlds")).toHaveLength(1);
    const nodeCalls = calls.filter((c) => c.role === "node");
    expect(nodeCalls).toHaveLength(8);
    expect(nodeCalls[0].messages[1].content).toContain("[あなたの世界]\n登山ガイド");
    expect(nodeCalls[7].messages[1].content).toContain("[あなたの世界]\n外交官");
    expect(nodeCalls[0].messages[0].content).toContain("experience");
    expect(res.nodes[0].world).toBe("登山ガイド");
    expect(res.nodes[0].experience).toContain("撤退");
    const synthUser = calls.find((c) => c.role === "synth")!.messages[1].content;
    expect(synthUser).toContain("[世界をまたぐ探求]");
  });

  it("選ぶ世界の数は起動する腕の数と一致する(どのドメインでも)", () => {
    for (const plan of ["light", "deep"] as const) {
      for (const d of ["love", "work", "money", "family", "self", "general"] as const) {
        expect(planWorldCount(plan)).toBe(planLenses(plan, d).length);
      }
    }
  });

  it("light では4つの世界を選ばせ、4つの腕に割り当てる", async () => {
    const calls: { role: ModelRole; messages: ChatMessage[] }[] = [];
    mockedCall.mockImplementation(dispatch(calls));
    const res = await runAnalyze(
      { input: "転職すべきか迷っている", summary: "", plan: "light", clientId: "c1" },
      { env: makeEnv({ WORLDS: "on" }), now: new Date(), requestId: "r" },
    );
    expect(calls.find((c) => c.role === "worlds")!.messages[0].content).toContain("4つ選ぶ");
    expect(res.nodes.map((n) => n.world)).toEqual(["登山ガイド", "落語家", "救急医", "農家"]);
  });

  it("世界の選定が「世界は要らない」(空)と判断したら、世界なしで答え、地図も作らない", async () => {
    const calls: { role: ModelRole; messages: ChatMessage[] }[] = [];
    const base = dispatch(calls) as unknown as (r: ModelRole, m: ChatMessage[]) => Promise<ModelCallResult>;
    mockedCall.mockImplementation(((role: ModelRole, m: ChatMessage[]) =>
      role === "worlds" ? (calls.push({ role, messages: m }), Promise.resolve(result('{"worlds":[]}'))) : base(role, m)) as unknown as typeof callModel);
    const res = await runAnalyze(
      { input: "100万円を年利3%で10年運用したら?", summary: "", plan: "light", clientId: "c1" },
      { env: makeEnv({ WORLDS: "on" }), now: new Date(), requestId: "r" },
    );
    expect(calls.some((c) => c.role === "mapper")).toBe(false);
    expect(res.meta.map).toBeNull();
    expect(res.nodes.every((n) => n.world === undefined)).toBe(true);
  });

  it("設定がオフなら世界を選ばない(従来どおり)", async () => {
    const calls: { role: ModelRole; messages: ChatMessage[] }[] = [];
    mockedCall.mockImplementation(dispatch(calls));
    await runAnalyze(
      { input: "転職すべきか迷っている", summary: "", plan: "light", clientId: "c1" },
      { env: makeEnv(), now: new Date(), requestId: "r" },
    );
    expect(calls.some((c) => c.role === "worlds")).toBe(false);
    expect(calls.filter((c) => c.role === "node").every((c) => !c.messages[1].content.includes("[あなたの世界]"))).toBe(true);
  });

  it("寄り添いモードの相談では、別の世界の話を持ち込まない", async () => {
    const calls: { role: ModelRole; messages: ChatMessage[] }[] = [];
    mockedCall.mockImplementation(dispatch(calls));
    await runAnalyze(
      { input: "もう死にたい", summary: "", plan: "light", clientId: "c1" },
      { env: makeEnv({ WORLDS: "on" }), now: new Date(), requestId: "r" },
    );
    expect(calls.some((c) => c.role === "worlds")).toBe(false);
  });

  it("世界の選定が失敗しても、世界なしで答える", async () => {
    const calls: { role: ModelRole; messages: ChatMessage[] }[] = [];
    const base = dispatch(calls) as unknown as (r: ModelRole, m: ChatMessage[]) => Promise<ModelCallResult>;
    mockedCall.mockImplementation(((role: ModelRole, m: ChatMessage[]) =>
      role === "worlds" ? Promise.reject(new Error("boom")) : base(role, m)) as unknown as typeof callModel);
    const res = await runAnalyze(
      { input: "転職すべきか迷っている", summary: "", plan: "light", clientId: "c1" },
      { env: makeEnv({ WORLDS: "on" }), now: new Date(), requestId: "r" },
    );
    expect(res.answer).toBe("回答本文");
    expect(res.nodes.every((n) => n.world === undefined)).toBe(true);
  });
});

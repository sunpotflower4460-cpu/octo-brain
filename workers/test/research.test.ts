import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/callModel.js", () => ({ callModel: vi.fn() }));
vi.mock("../src/lib/callModelStream.js", () => ({ callModelStream: vi.fn() }));

import { callModel } from "../src/lib/callModel.js";
import { boundaryAfterResearch, runAnalyze } from "../src/lib/analyze.js";
import {
  articleLabel,
  fetchLawArticle,
  fetchWeb,
  fetchWikiSummary,
  normalizeArticle,
  parseResearchPlan,
  runResearch,
} from "../src/lib/research.js";
import { parseResearch } from "../src/lib/worlds.js";
import { researchBlock } from "../src/lib/synthesize.js";
import type { ModelRole } from "../src/config/models.js";
import type { ChatMessage, Env, ModelCallResult } from "../src/types.js";

const mockedCall = vi.mocked(callModel);
const result = (text: string): ModelCallResult => ({ text, inTok: 0, outTok: 0, ms: 0, estimated: false });

function makeEnv(extra: Record<string, string> = {}): { env: Env; store: Map<string, string> } {
  const store = new Map<string, string>();
  const kv = {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => void store.set(k, v),
  } as unknown as KVNamespace;
  return { env: { OCTO_KV: kv, DEEPSEEK_API_KEY: "k", ...extra }, store };
}

const LAW_LIST = {
  laws: [
    { law_info: { law_id: "X1" }, revision_info: { law_title: "労働基準法施行規則", current_revision_status: "CurrentEnforced" } },
    { law_info: { law_id: "322AC0000000049" }, revision_info: { law_title: "労働基準法", current_revision_status: "CurrentEnforced" } },
  ],
};
const LAW_DATA = {
  law_full_text: {
    tag: "Article",
    children: [
      { tag: "ArticleCaption", children: ["（解雇の予告）"] },
      { tag: "Paragraph", children: [{ tag: "Sentence", children: ["少くとも三十日前にその予告をしなければならない。"] }] },
    ],
  },
};
const WIKI = (pages: unknown[]) => ({ query: { pages } });

// URL ごとに応答を返す fetch のモック
function mockFetch(routes: [RegExp, unknown | ((init?: RequestInit) => unknown)][]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const hit = routes.find(([re]) => re.test(url));
    if (!hit) return new Response("not found", { status: 404 });
    const body = typeof hit[1] === "function" ? (hit[1] as (i?: RequestInit) => unknown)(init) : hit[1];
    return new Response(JSON.stringify(body), { status: 200 });
  }));
  return calls;
}

beforeEach(() => mockedCall.mockReset());
afterEach(() => vi.unstubAllGlobals());

describe("検索計画の読み取り", () => {
  it("法令名と条番号・記事名・検索語を上限つきで取り出す", () => {
    const p = parseResearchPlan({
      laws: [{ law: "労働基準法", article: "第二十条" }, { law: "労働基準法", article: "20" }, { law: "雇用保険法", article: "61の4" }, { law: "x", article: "1" }],
      topics: ["解雇", "", "育児休業", "三つ目"],
      web: ["住宅ローン 金利 2026", "二つ目"],
    });
    // 漢数字の条番号は読めないので捨てる
    expect(p?.laws).toEqual([{ law: "労働基準法", article: "20" }, { law: "雇用保険法", article: "61_4" }]);
    expect(p?.topics).toEqual(["解雇", "育児休業"]);
    expect(p?.web).toEqual(["住宅ローン 金利 2026"]);
  });
  it("何も調べないなら null", () => {
    expect(parseResearchPlan(null)).toBeNull();
    expect(parseResearchPlan({ laws: [], topics: [], web: [] })).toBeNull();
    expect(parseResearch('{"worlds":[],"research":null}')).toBeNull();
    expect(parseResearch('{"worlds":[],"research":{"topics":["解雇"]}}')?.topics).toEqual(["解雇"]);
  });
  it("条番号の正規化と表示", () => {
    expect(normalizeArticle("第20条")).toBe("20");
    expect(normalizeArticle("２０")).toBe("20");
    expect(normalizeArticle("61の4")).toBe("61_4");
    expect(normalizeArticle("二十")).toBe("");
    expect(articleLabel("61_4")).toBe("第61条の4");
    expect(articleLabel("20")).toBe("第20条");
  });
});

describe("法令(e-Gov)", () => {
  it("正式名称が完全一致する現行法令の条文を取り出す", async () => {
    const calls = mockFetch([[/\/laws\?/, LAW_LIST], [/law_data\/322AC0000000049\?elm=MainProvision-Article_20/, LAW_DATA]]);
    const s = await fetchLawArticle("労働基準法", "20");
    expect(s).toEqual({
      kind: "law",
      title: "労働基準法 第20条",
      url: "https://laws.e-gov.go.jp/law/322AC0000000049",
      text: "（解雇の予告）少くとも三十日前にその予告をしなければならない。",
    });
    expect(calls[0].url).toContain(encodeURIComponent("労働基準法"));
  });
  it("完全一致する法令がなければ null(似た名前の施行規則は使わない)", async () => {
    mockFetch([[/\/laws\?/, { laws: [LAW_LIST.laws[0]] }]]);
    expect(await fetchLawArticle("労働基準法", "20")).toBeNull();
  });
});

describe("Wikipedia", () => {
  it("記事名が一致した要約を使い、連絡先つきの User-Agent を付ける", async () => {
    const calls = mockFetch([[/ja\.wikipedia\.org/, WIKI([{ title: "解雇", extract: "解雇は労働契約の解除である。", fullurl: "https://ja.wikipedia.org/wiki/x" }])]]);
    const s = await fetchWikiSummary("解雇", "ja");
    expect(s?.title).toBe("解雇(Wikipedia)");
    expect(s?.text).toBe("解雇は労働契約の解除である。");
    expect((calls[0].init?.headers as Record<string, string>)["User-Agent"]).toContain("OctoBrain");
  });
  it("記事がない・曖昧さ回避ページは使わない", async () => {
    mockFetch([[/wikipedia/, WIKI([{ title: "解雇", missing: true }])]]);
    expect(await fetchWikiSummary("解雇", "ja")).toBeNull();
    vi.unstubAllGlobals();
    mockFetch([[/wikipedia/, WIKI([{ title: "A", extract: "e", fullurl: "u", pageprops: { disambiguation: "" } }])]]);
    expect(await fetchWikiSummary("A", "ja")).toBeNull();
  });
});

describe("ウェブ検索(Tavily)", () => {
  it("キーがなければ呼ばない", async () => {
    const calls = mockFetch([]);
    expect(await fetchWeb("金利", makeEnv().env)).toEqual([]);
    expect(calls).toHaveLength(0);
  });
  it("結果を KV に保存し、同じ検索語は2回目から取りに行かない", async () => {
    const calls = mockFetch([[/tavily/, { results: [{ title: "金利動向", url: "https://e.com/a", content: "変動金利は…", published_date: "2026-09-20T00:00" }] }]]);
    const { env } = makeEnv({ TAVILY_API_KEY: "tv" });
    const first = await fetchWeb("住宅ローン 金利", env);
    expect(first[0]).toEqual({ kind: "web", title: "金利動向(2026-09-20)", url: "https://e.com/a", text: "変動金利は…" });
    expect((calls[0].init?.headers as Record<string, string>).authorization).toBe("Bearer tv");
    const second = await fetchWeb("住宅ローン 金利", env);
    expect(second).toEqual(first);
    expect(calls).toHaveLength(1);
  });
});

describe("調べものの実行と受け渡し", () => {
  it("失敗は理由つきで返し、取れた資料は使う(同じ URL は1つ)", async () => {
    mockFetch([[/wikipedia/, WIKI([{ title: "解雇", extract: "e", fullurl: "https://ja.wikipedia.org/wiki/x" }])]]);
    const r = await runResearch({ laws: [{ law: "労働基準法", article: "20" }], topics: ["解雇", "解雇 "], web: [] }, { env: makeEnv().env, lang: "ja" });
    expect(r.sources).toHaveLength(1);
    expect(r.failures).toEqual(["law:http_404"]);
  });
  it("統合脳への資料ブロック", () => {
    const b = researchBlock([{ kind: "law", title: "労働基準法 第20条", url: "u", text: "三十日前に予告" }]);
    expect(b).toContain("[S1] (法令・e-Gov) 労働基準法 第20条: 三十日前に予告");
    expect(b).toContain("この資料を優先する");
    expect(researchBlock([])).toBeNull();
  });
  it("ウェブの資料が取れたときだけ「最新情報は持っていない」の但し書きを外す", () => {
    const web = [{ kind: "web" as const, title: "t", url: "u", text: "x" }];
    expect(boundaryAfterResearch("recency", web)).toBeNull();
    expect(boundaryAfterResearch("recency", [{ ...web[0], kind: "wiki" }])).toBe("recency");
    expect(boundaryAfterResearch("math", web)).toBe("math");
  });
});

describe("回答が使った資料の判定", () => {
  const law = { kind: "law" as const, title: "民法 第627条", url: "u1", text: "" };
  const wiki = { kind: "wiki" as const, title: "退職(Wikipedia)", url: "u2", text: "" };
  const web = { kind: "web" as const, title: "金利", url: "u3", text: "" };
  it("法令は名前と条番号の両方、百科事典は記事名か Wikipedia、ウェブは常に残す", async () => {
    const { citedSources } = await import("../src/lib/research.js");
    expect(citedSources("民法 第 627 条により2週間で終了します", [law, wiki, web])).toEqual([law, web]);
    expect(citedSources("民法の考え方では", [law])).toEqual([]);
    expect(citedSources("退職の申し出は", [wiki])).toEqual([wiki]);
    expect(citedSources("Wikipediaによると", [wiki])).toEqual([wiki]);
  });
});

describe("パイプライン", () => {
  const WORLDS = JSON.stringify({ worlds: [], research: { laws: [{ law: "労働基準法", article: "20" }], topics: [], web: [] } });
  function dispatch(calls: { role: ModelRole; messages: ChatMessage[] }[], answer = "本文") {
    return ((role: ModelRole, messages: ChatMessage[]) => {
      calls.push({ role, messages });
      const t: Partial<Record<ModelRole, string>> = {
        router: "work",
        worlds: WORLDS,
        node: JSON.stringify({ opinions: [{ claim: "c", weight: 0.8, why: "w" }], flag: null }),
        synth: answer + '\n---TENSION--- {"axis":"時の軸","reason":"r"}\n---SUMMARY---\n要約',
        verifier: "pass",
      };
      return Promise.resolve(result(t[role] ?? "{}"));
    }) as unknown as typeof callModel;
  }

  it("調べた条文を統合脳に渡し、回答が使った出典を meta.sources に載せる", async () => {
    mockFetch([[/\/laws\?/, LAW_LIST], [/law_data/, LAW_DATA]]);
    const calls: { role: ModelRole; messages: ChatMessage[] }[] = [];
    mockedCall.mockImplementation(dispatch(calls, "労働基準法第20条では、30日前の予告が必要です。"));
    const res = await runAnalyze(
      { input: "来週でクビと言われた。これって普通?", summary: "", plan: "light", clientId: "c1" },
      { env: makeEnv({ WORLDS: "on" }).env, now: new Date(), requestId: "r" },
    );
    const synthUser = calls.find((c) => c.role === "synth")!.messages[1].content;
    expect(synthUser).toContain("[調べて確かめた資料]");
    expect(synthUser).toContain("労働基準法 第20条");
    expect(res.meta.sources).toEqual([{ kind: "law", title: "労働基準法 第20条", url: "https://laws.e-gov.go.jp/law/322AC0000000049" }]);
  });

  it("回答が使わなかった資料は出典に出さない", async () => {
    mockFetch([[/\/laws\?/, LAW_LIST], [/law_data/, LAW_DATA]]);
    const calls: { role: ModelRole; messages: ChatMessage[] }[] = [];
    mockedCall.mockImplementation(dispatch(calls, "まずは落ち着いて状況を整理しましょう。"));
    const res = await runAnalyze(
      { input: "来週でクビと言われた。これって普通?", summary: "", plan: "light", clientId: "c1" },
      { env: makeEnv({ WORLDS: "on" }).env, now: new Date(), requestId: "r" },
    );
    expect(res.meta.sources).toBeUndefined();
  });

  it("RESEARCH=off なら調べない", async () => {
    const fetchCalls = mockFetch([]);
    const calls: { role: ModelRole; messages: ChatMessage[] }[] = [];
    mockedCall.mockImplementation(dispatch(calls));
    const res = await runAnalyze(
      { input: "来週でクビと言われた。これって普通?", summary: "", plan: "light", clientId: "c1" },
      { env: makeEnv({ WORLDS: "on", RESEARCH: "off" }).env, now: new Date(), requestId: "r" },
    );
    expect(fetchCalls).toHaveLength(0);
    expect(res.meta.sources).toBeUndefined();
  });

  it("調べものが失敗しても答え、理由を warnings に出す", async () => {
    mockFetch([]);
    const calls: { role: ModelRole; messages: ChatMessage[] }[] = [];
    mockedCall.mockImplementation(dispatch(calls));
    const res = await runAnalyze(
      { input: "来週でクビと言われた。これって普通?", summary: "", plan: "light", clientId: "c1" },
      { env: makeEnv({ WORLDS: "on" }).env, now: new Date(), requestId: "r" },
    );
    expect(res.answer).toBe("本文");
    expect(res.meta.warnings?.some((w) => w.startsWith("research_failed: law:http_404"))).toBe(true);
  });
});

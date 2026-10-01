// 調べもの(research)。腕の facts はモデルの記憶なので古い・誤りがあり得る。
// 判断に関わる情報を、無料で正当に使える公的・公開の情報源で確かめて統合脳に渡す。
// - law : e-Gov 法令API(デジタル庁)。モデルが挙げた「法令名+条」を公式の現行条文で確かめる
// - wiki: Wikipedia(記事名の完全一致のみ。全文検索は無関係な記事が混ざるため使わない)
// - web : Tavily(最新情報が要るときだけ。TAVILY_API_KEY があるときだけ。結果は KV に1日保存)
// 外部に送るのは、世界の選定と同じ呼び出しでモデルが作った一般的な検索語だけ(相談本文は送らない)。
// 失敗・時間切れは黙って捨てず、呼び出し側で meta.warnings に載せる。回答自体は止めない。

import type { Env } from "../types.js";

export type SourceKind = "law" | "wiki" | "web";

export interface ResearchSource {
  kind: SourceKind;
  title: string;
  url: string;
  text: string;
}

// 世界の選定と同じ呼び出しでモデルが出す「何を調べるか」
export interface ResearchPlan {
  laws: { law: string; article: string }[];
  topics: string[];
  web: string[];
}

export interface ResearchResult {
  sources: ResearchSource[];
  failures: string[];
}

const MAX_LAWS = 2;
const MAX_TOPICS = 2;
const MAX_WEB = 1;
const TEXT_MAX = 360;
const QUERY_MAX = 40;
const FETCH_TIMEOUT_MS = 3500;
const WEB_CACHE_TTL_S = 86400;
const EGOV = "https://laws.e-gov.go.jp/api/2";
// Wikimedia の利用規約に従い、連絡先の分かる User-Agent を付ける(利用者の情報は含めない)
const USER_AGENT = "OctoBrain/1.0 (+https://octo-brain.sunpotflower4460.workers.dev/support)";

const str = (v: unknown, max = QUERY_MAX) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// モデルの出力(research 部分)を検索計画にする。何も調べないなら null。
export function parseResearchPlan(v: unknown): ResearchPlan | null {
  if (v === null || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const laws = (Array.isArray(o.laws) ? o.laws : [])
    .map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>) : null))
    .filter((x): x is Record<string, unknown> => x !== null)
    .map((x) => ({ law: str(x.law), article: normalizeArticle(str(x.article)) }))
    .filter((x) => x.law && x.article)
    .slice(0, MAX_LAWS);
  const list = (a: unknown, n: number) =>
    (Array.isArray(a) ? a : []).map((x) => str(x)).filter(Boolean).slice(0, n);
  const plan = { laws, topics: list(o.topics, MAX_TOPICS), web: list(o.web, MAX_WEB) };
  return plan.laws.length + plan.topics.length + plan.web.length > 0 ? plan : null;
}

// 「第二十条」「20」「61の4」→ e-Gov の要素名に使う "20" / "61_4"。解釈できなければ空。
export function normalizeArticle(a: string): string {
  const t = a.replace(/[第条\s]/g, "").replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  const m = t.match(/^(\d+)(?:(?:の|_|-)(\d+))?$/);
  if (!m) return "";
  return m[2] ? `${m[1]}_${m[2]}` : m[1];
}

// "61_4" → "第61条の4"
export function articleLabel(article: string): string {
  const [main, sub] = article.split("_");
  return `第${main}条${sub ? `の${sub}` : ""}`;
}

async function fetchJson(url: string, init: RequestInit = {}, signal?: AbortSignal): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`http_${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

// e-Gov の条文 JSON(tag/children の木)を平文にする
function flatten(n: unknown): string {
  if (typeof n === "string") return n;
  if (n && typeof n === "object" && Array.isArray((n as { children?: unknown }).children)) {
    return ((n as { children: unknown[] }).children).map(flatten).join("");
  }
  return "";
}

// 法令名(完全一致・現行)→ 条文。モデルが挙げた条が本当にその内容かは、統合脳が本文で確かめる
export async function fetchLawArticle(law: string, article: string, signal?: AbortSignal): Promise<ResearchSource | null> {
  const list = (await fetchJson(
    `${EGOV}/laws?law_title=${encodeURIComponent(law)}&limit=50&response_format=json`,
    {},
    signal,
  )) as { laws?: { law_info: { law_id: string }; revision_info: { law_title: string; current_revision_status?: string } }[] };
  const hit = (list.laws ?? []).find(
    (l) => l.revision_info.law_title === law && l.revision_info.current_revision_status !== "Repeal",
  );
  if (!hit) return null;
  const id = hit.law_info.law_id;
  const data = (await fetchJson(
    `${EGOV}/law_data/${id}?elm=MainProvision-Article_${article}&response_format=json&law_full_text_format=json`,
    {},
    signal,
  )) as { law_full_text?: unknown };
  const text = flatten(data.law_full_text).trim();
  if (!text) return null;
  return {
    kind: "law",
    title: `${law} ${articleLabel(article)}`,
    url: `https://laws.e-gov.go.jp/law/${id}`,
    text: text.slice(0, TEXT_MAX),
  };
}

// Wikipedia の記事(記事名の完全一致・転送を辿る)。曖昧さ回避ページは使わない
export async function fetchWikiSummary(topic: string, lang: "ja" | "en", signal?: AbortSignal): Promise<ResearchSource | null> {
  const url =
    `https://${lang}.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(topic)}` +
    "&redirects=1&prop=extracts%7Cinfo%7Cpageprops&exintro=1&explaintext=1&exchars=400&inprop=url&format=json&formatversion=2";
  const d = (await fetchJson(url, { headers: { "User-Agent": USER_AGENT } }, signal)) as {
    query?: { pages?: { title: string; missing?: boolean; extract?: string; fullurl?: string; pageprops?: Record<string, unknown> }[] };
  };
  const p = d.query?.pages?.[0];
  if (!p || p.missing || !p.extract || !p.fullurl || (p.pageprops && "disambiguation" in p.pageprops)) return null;
  return { kind: "wiki", title: `${p.title}(Wikipedia)`, url: p.fullurl, text: p.extract.trim().slice(0, TEXT_MAX) };
}

// Tavily の検索(最新情報)。同じ検索語は KV に1日保存して、無料枠を節約する
export async function fetchWeb(query: string, env: Env, signal?: AbortSignal): Promise<ResearchSource[]> {
  const key = env.TAVILY_API_KEY;
  if (typeof key !== "string" || key.length === 0) return [];
  const cacheKey = `research:web:${query}`;
  try {
    const cached = await env.OCTO_KV.get(cacheKey);
    if (cached) return JSON.parse(cached) as ResearchSource[];
  } catch {
    // 読めなければ取りに行く
  }
  const d = (await fetchJson(
    "https://api.tavily.com/search",
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ query, max_results: 3, search_depth: "basic", include_answer: false }),
    },
    signal,
  )) as { results?: { title?: string; url?: string; content?: string; published_date?: string }[] };
  const out: ResearchSource[] = (d.results ?? [])
    .filter((r) => r.url && r.content)
    .slice(0, 3)
    .map((r) => ({
      kind: "web" as const,
      title: `${(r.title ?? r.url ?? "").slice(0, 60)}${r.published_date ? `(${r.published_date.slice(0, 10)})` : ""}`,
      url: r.url as string,
      text: (r.content as string).slice(0, TEXT_MAX),
    }));
  try {
    // 書き込み上限(無料プラン)で失敗しても回答は止めない
    await env.OCTO_KV.put(cacheKey, JSON.stringify(out), { expirationTtl: WEB_CACHE_TTL_S });
  } catch {
    // 保存できなくても結果は使う
  }
  return out;
}

// 検索計画を並列に実行する。英語の相談なら英語版 Wikipedia を使う
export async function runResearch(
  plan: ResearchPlan,
  opts: { env: Env; lang: "ja" | "en"; signal?: AbortSignal },
): Promise<ResearchResult> {
  const tasks: { name: string; run: () => Promise<ResearchSource | ResearchSource[] | null> }[] = [
    ...plan.laws.map((l) => ({ name: "law", run: () => fetchLawArticle(l.law, l.article, opts.signal) })),
    ...plan.topics.map((t) => ({ name: "wiki", run: () => fetchWikiSummary(t, opts.lang, opts.signal) })),
    ...plan.web.map((q) => ({ name: "web", run: () => fetchWeb(q, opts.env, opts.signal) })),
  ];
  const settled = await Promise.allSettled(tasks.map((t) => t.run()));
  const sources: ResearchSource[] = [];
  const failures: string[] = [];
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") {
      if (Array.isArray(s.value)) sources.push(...s.value);
      else if (s.value) sources.push(s.value);
    } else {
      const msg = s.reason instanceof Error ? (s.reason.name === "AbortError" ? "timeout" : s.reason.message) : "error";
      failures.push(`${tasks[i].name}:${msg}`.slice(0, 60));
    }
  });
  // 同じ URL は1つに
  const seen = new Set<string>();
  return { sources: sources.filter((s) => (seen.has(s.url) ? false : (seen.add(s.url), true))), failures };
}

// 回答が実際に使った資料だけを残す(出典として見せる)。
// 法令は「法令名」と「条番号」の両方が本文にあるとき、百科事典は記事名か「Wikipedia」があるとき。
// ウェブ検索は最新情報のために明示的に調べたものなので残す。
export function citedSources(answer: string, sources: ResearchSource[]): ResearchSource[] {
  const plain = answer.replace(/\s/g, "");
  return sources.filter((s) => {
    if (s.kind === "web") return true;
    if (s.kind === "wiki") {
      const name = s.title.replace(/\(Wikipedia\)$/, "");
      return plain.includes(name) || /wikipedia/i.test(plain);
    }
    const m = s.title.match(/^(.+?) 第(\d+)条/);
    return m !== null && plain.includes(m[1]) && plain.includes(`${m[2]}条`);
  });
}

// 調べものを使う設定か(wrangler vars の RESEARCH。既定オン)
export function researchEnabled(env: Env): boolean {
  return env.RESEARCH !== "off";
}

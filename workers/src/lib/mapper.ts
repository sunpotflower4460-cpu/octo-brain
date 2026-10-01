// 視点の地図(mapper)。1つのモデルが最善の答えに畳むと見えなくなる「視点の分布」を取り出す。
// - agree: 多くの視点がそろった見方と、その人数(合意の強さ)
// - split: 視点どうしが割れたところ
// - lone : ひとつの視点だけが指摘した、見落とせない点(少数意見)
// 統合脳と並列に1回だけ呼ぶ(待ち時間を増やさない)。意見は番号で参照させ、引用はコード側で
// 元の文をそのまま使う(写し間違い・捏造を防ぐ)。全呼び出しは callModel 経由(絶対ルール5)。

import { callModel } from "./callModel.js";
import { isUsableNode } from "./runNodes.js";
import type { CostSink, Env, NodeResult, PerspectiveMap } from "../types.js";

const MAPPER_SYSTEM = `あなたは、複数の独立した視点の意見を見比べて「視点の地図」を作る係です。意見を要約したり、自分の意見を足したりしない。
次の3つを見つける:
- agree: 3つ以上(視点が4つ以下なら2つ以上)の視点が、表現は違っても同じ方向を向いている見方。point に一文で。ids にその意見の番号
- split: 2つの視点が、同じ論点で異なる(対立する・順序が違う)結論を出しているところ。about に何について割れたか一文で。a と b に意見の番号(別の視点から)
- lone: ひとつの視点だけが指摘していて、他の視点は触れていないが、相談者が見落とすと困る点。耳の痛い指摘や前提を疑う指摘を優先する。id に意見の番号、why に見落とせない理由を一文で
- essence: [各世界の経験] が与えられたときだけ。違う世界の経験のうち3つ以上に共通して流れている本質(原理)を、どの世界にも当てはまる一文で。表面の言葉の一致ではなく、場面は違っても同じ理(ことわり)を指しているものを探す。相談者の状況にも通じるもの。worlds に経験の番号(E1 なら 1)
該当が無いものは null。無理に作らない。相談が単純な事実・相場・手順の質問や作業の依頼(迷いや判断を含まないもの)なら、すべて null にする。出力は次のJSONのみ(前置き禁止):
{"agree":{"point":"","ids":[1,2,3]} | null,"split":{"about":"","a":1,"b":2} | null,"lone":{"id":1,"why":""} | null,"essence":{"point":"","worlds":[1,2,3]} | null}`;

// 照合モード(法律・事実の質問)の地図。違う意見ではなく、独立した確かめの一致・食い違いを見る
const MAPPER_CHECK_SYSTEM = `あなたは、複数の確認役が独立に確かめた事実と意見を見比べて「照合の地図」を作る係です。要約したり、自分の意見を足したりしない。
次の3つを見つける:
- agree: 3つ以上(確認役が4つ以下なら2つ以上)が、表現は違っても同じ内容を挙げた事実や結論。point に一文で。ids に番号
- split: 2つの確認役が、同じ点について食い違う(数字・条件・結論が違う)ことを言っているところ。両方が同時には正しくあり得ないときだけ。条件つきの説明と留保、原則と例外のように両立するものは split にしない。about に何が食い違ったか一文で。a と b に番号(別の確認役から)
- lone: ひとつの確認役だけが挙げていて、見落とすと相談者が困る条件・例外・期限・手順。id に番号、why に見落とせない理由を一文で
該当が無いものは null。無理に作らない。essence は常に null。出力は次のJSONのみ(前置き禁止):
{"agree":{"point":"","ids":[1,2,3]} | null,"split":{"about":"","a":1,"b":2} | null,"lone":{"id":1,"why":""} | null,"essence":null}`;

interface Item {
  lens: string;
  claim: string;
  world?: string;
}

// 使えた腕の意見を番号付きで並べる(番号 → 腕・元の文)。照合モードでは確かめた事実も並べる
export function mapperItems(nodes: NodeResult[], check = false): Item[] {
  return nodes.filter(isUsableNode).flatMap((n) => [
    ...(check ? (n.facts ?? []).map((f) => ({ lens: n.id as string, claim: f.text })) : []),
    ...n.opinions.map((o) => ({ lens: n.id as string, claim: o.claim, ...(n.world ? { world: n.world } : {}) })),
  ]);
}

// 世界つきの腕の経験(番号 E1.. → 腕・世界)
interface Experience {
  lens: string;
  world: string;
  text: string;
}

export function mapperExperiences(nodes: NodeResult[]): Experience[] {
  return nodes
    .filter((n) => isUsableNode(n) && n.world && n.experience)
    .map((n) => ({ lens: n.id as string, world: n.world as string, text: n.experience as string }));
}

export function buildMapperInput(input: string, items: Item[], exps: Experience[] = []): string {
  const lines = items.map((it, i) => `[${i + 1}] (${it.world ? `${it.lens}・${it.world}` : it.lens}) ${it.claim}`);
  const parts = [`[相談]\n${input}`, `[各視点の意見]\n${lines.join("\n")}`];
  if (exps.length > 0) {
    parts.push(`[各世界の経験]\n${exps.map((e, i) => `[E${i + 1}] (${e.world}) ${e.text}`).join("\n")}`);
  }
  return parts.join("\n\n");
}

// モデルの番号付き回答を、元の腕・元の文に戻して地図にする。不正な番号・形は捨てる(非致命)。
export function parseMapperOutput(raw: string, items: Item[], exps: Experience[] = []): PerspectiveMap | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    // 軽量モデルは括弧の対応を崩すことがある。4つの部分を1つずつ拾い直す
    o = salvageSections(raw);
  }
  const at = (v: unknown): Item | null =>
    typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= items.length ? items[v - 1] : null;
  const text = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 120) : "");

  let agree: PerspectiveMap["agree"] = null;
  const ag = o.agree as Record<string, unknown> | null;
  if (ag && typeof ag === "object" && Array.isArray(ag.ids) && text(ag.point)) {
    const lenses = [...new Set(ag.ids.map(at).filter((x): x is Item => x !== null).map((x) => x.lens))];
    if (lenses.length >= 2) agree = { point: text(ag.point), lenses };
  }
  let split: PerspectiveMap["split"] = null;
  const sp = o.split as Record<string, unknown> | null;
  if (sp && typeof sp === "object" && text(sp.about)) {
    const a = at(sp.a);
    const b = at(sp.b);
    if (a && b && a.lens !== b.lens) split = { about: text(sp.about), a, b };
  }
  let lone: PerspectiveMap["lone"] = null;
  const lo = o.lone as Record<string, unknown> | null;
  if (lo && typeof lo === "object" && text(lo.why)) {
    const it = at(lo.id);
    if (it) lone = { lens: it.lens, claim: it.claim, why: text(lo.why), ...(it.world ? { world: it.world } : {}) };
  }
  // 本質: 3つ以上の別々の世界の経験を指していることを番号で確かめる
  let essence: PerspectiveMap["essence"] = null;
  const es = o.essence as Record<string, unknown> | null;
  if (es && typeof es === "object" && Array.isArray(es.worlds) && text(es.point)) {
    const picked = es.worlds
      .map((v) => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= exps.length ? exps[v - 1] : null))
      .filter((x): x is Experience => x !== null);
    const uniq = [...new Map(picked.map((e) => [e.world, e])).values()];
    if (uniq.length >= 3) {
      essence = { point: text(es.point), lenses: uniq.map((e) => e.lens), worlds: uniq.map((e) => e.world) };
    }
  }
  return agree || split || lone || essence ? { agree, split, lone, essence } : null;
}

const SECTION_KEYS = ["agree", "split", "lone", "essence"] as const;

// 壊れた JSON から、各部分の値(文字列・番号・番号の配列)を正規表現で拾う。
// 各部分は「"key":」から次の部分名までの区間とし、その中のフィールドだけを読む。
export function salvageSections(raw: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const starts = SECTION_KEYS.map((k) => ({ k, i: raw.indexOf(`"${k}"`) })).filter((s) => s.i !== -1);
  for (const { k, i } of starts) {
    const from = i + k.length + 2;
    const nexts = SECTION_KEYS.map((n) => raw.indexOf(`"${n}"`, from)).filter((j) => j !== -1);
    const seg = raw.slice(from, nexts.length > 0 ? Math.min(...nexts) : raw.length);
    if (/^\s*:\s*null/.test(seg)) {
      out[k] = null;
      continue;
    }
    const obj: Record<string, unknown> = {};
    for (const f of ["point", "about", "why"]) {
      const m = seg.match(new RegExp(`"${f}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
      if (m) obj[f] = m[1];
    }
    for (const f of ["id", "a", "b"]) {
      const m = seg.match(new RegExp(`"${f}"\\s*:\\s*(\\d+)`));
      if (m) obj[f] = Number(m[1]);
    }
    for (const f of ["ids", "worlds"]) {
      const m = seg.match(new RegExp(`"${f}"\\s*:\\s*\\[([\\d,\\s]*)\\]`));
      if (m) obj[f] = m[1].split(",").map((x) => x.trim()).filter(Boolean).map(Number);
    }
    out[k] = obj;
  }
  return out;
}

// 地図を作る。使えた意見が3つ未満なら作らない。失敗は null(回答自体は止めない)。
// 失敗の理由は onFailure で呼び出し側へ渡し、meta.warnings で可視化する(握りつぶさない)。
export async function runMapper(
  input: string,
  nodes: NodeResult[],
  opts: { env: Env; collector?: CostSink; signal?: AbortSignal; check?: boolean; onFailure?: (reason: string) => void },
): Promise<PerspectiveMap | null> {
  const items = mapperItems(nodes, opts.check === true);
  if (items.length < 3) return null;
  const exps = mapperExperiences(nodes);
  try {
    const res = await callModel(
      "mapper",
      [
        { role: "system", content: opts.check ? MAPPER_CHECK_SYSTEM : MAPPER_SYSTEM },
        { role: "user", content: buildMapperInput(input, items, exps) },
      ],
      { env: opts.env, collector: opts.collector, signal: opts.signal },
    );
    if (res.truncated) opts.onFailure?.("truncated");
    const map = parseMapperOutput(res.text, items, exps);
    if (!map && !res.truncated && res.text.includes(":") && /"(agree|split|lone|essence)"\s*:\s*\{/.test(res.text)) {
      opts.onFailure?.("unparsable");
    }
    return map;
  } catch (err) {
    opts.onFailure?.(`call_error: ${err instanceof Error ? err.message : String(err)}`.slice(0, 120));
    return null;
  }
}

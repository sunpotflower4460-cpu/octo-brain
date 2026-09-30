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
該当が無いものは null。無理に作らない。相談が単純な事実・相場・手順の質問や作業の依頼(迷いや判断を含まないもの)なら、すべて null にする。出力は次のJSONのみ(前置き禁止):
{"agree":{"point":"","ids":[1,2,3]} | null,"split":{"about":"","a":1,"b":2} | null,"lone":{"id":1,"why":""} | null}`;

interface Item {
  lens: string;
  claim: string;
}

// 使えた腕の意見を番号付きで並べる(番号 → 腕・元の文)
export function mapperItems(nodes: NodeResult[]): Item[] {
  return nodes
    .filter(isUsableNode)
    .flatMap((n) => n.opinions.map((o) => ({ lens: n.id as string, claim: o.claim })));
}

export function buildMapperInput(input: string, items: Item[]): string {
  const lines = items.map((it, i) => `[${i + 1}] (${it.lens}) ${it.claim}`);
  return `[相談]\n${input}\n\n[各視点の意見]\n${lines.join("\n")}`;
}

// モデルの番号付き回答を、元の腕・元の文に戻して地図にする。不正な番号・形は捨てる(非致命)。
export function parseMapperOutput(raw: string, items: Item[]): PerspectiveMap | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
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
    if (it) lone = { lens: it.lens, claim: it.claim, why: text(lo.why) };
  }
  return agree || split || lone ? { agree, split, lone } : null;
}

// 地図を作る。使えた意見が3つ未満なら作らない。失敗は null(回答自体は止めない)。
export async function runMapper(
  input: string,
  nodes: NodeResult[],
  opts: { env: Env; collector?: CostSink; signal?: AbortSignal },
): Promise<PerspectiveMap | null> {
  const items = mapperItems(nodes);
  if (items.length < 3) return null;
  try {
    const res = await callModel(
      "mapper",
      [
        { role: "system", content: MAPPER_SYSTEM },
        { role: "user", content: buildMapperInput(input, items) },
      ],
      { env: opts.env, collector: opts.collector, signal: opts.signal },
    );
    return parseMapperOutput(res.text, items);
  } catch {
    return null;
  }
}

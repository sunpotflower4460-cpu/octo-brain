// 視点の世界(worlds)。相談ごとに、8つの腕が立つ「違う世界」を選ぶ。
// 腕の見方(論理・盾・鏡…)は同じでも、立つ世界が違えば当たり前・大事なもの・例えが違う。
// 1つのモデルが最善の答えに向かうと寄りがちな「相談に近い常識的な視点」から離れ、
// 同じ問いを別の世界から探求した結果を持ち寄らせるための仕掛け。
// - 世界は相談のテーマに通じるものだけ(関係のない世界は雑音になる)
// - 職業名だけでなく、その世界で日々向き合っている判断や制約を書かせる(浅い役柄を避ける)
// - 単純な質問・作業依頼・雑談には世界を立てない(空配列)
// 失敗・不正応答は null(世界なしで従来どおり動く)。全呼び出しは callModel 経由(絶対ルール5)。

import { callModel } from "./callModel.js";
import { parseResearchPlan, type ResearchPlan } from "./research.js";
import type { CostSink, Env, World } from "../types.js";
import type { AxisId } from "../config/nodes.js";

// 世界の選定の結果。worlds: 空配列は「世界を立てない」、null は失敗。research: 調べることが無ければ null
export interface WorldsPlan {
  worlds: World[] | null;
  research: ResearchPlan | null;
  // explore: 違う世界から探求する / check: 法律・事実の質問を全腕で独立に確かめる(照合)
  mode: InquiryMode;
  // この相談でいちばん問われている2つの軸(ライトで起動する腕の選択に使える)。読めなければ null
  axes?: AxisId[] | null;
}

export type InquiryMode = "explore" | "check";

export const WORLD_COUNT = 8;
const NAME_MAX = 30;
const DAILY_MAX = 60;

function worldsSystem(count: number): string {
  return `あなたは、ひとつの相談を「違う世界を生きる人たち」に見てもらうための世界を選ぶ係です。
相談のテーマに通じる経験を持ちながら、互いにできるだけ遠い世界を${count}つ選ぶ。
- 相談者と同じ業界・立場の世界(相談が転職なら「転職経験者」「会社員」など)は1つまで。残りは、仕事・年代・暮らし・価値観がばらばらで、相談者の周りからは出てこない世界にする(例: プロのスポーツ選手、宮大工、救急医、将棋の棋士、登山ガイド、農家、ジャズ奏者、保育士、漁師、外交官、禅僧、料理人 など。例に縛られない)
- ただし、相談の芯にあるテーマ(見切りの付け方・続けるか変えるか・人との距離・お金と時間の配分・失敗の扱い など)について、その世界に独自の知恵・慣習・判断基準があるものだけを選ぶ
- name は世界の名前(${NAME_MAX}字以内)。daily は、その世界で相談のテーマに通じる、具体的な判断の場面や慣習(${DAILY_MAX}字以内。例: 登山ガイド「天候が崩れる前に、登頂を諦める時刻を出発前に決めておく」)。「チームワークが大事」のような決まり文句は書かない
- 迷いや判断を含まない相談(単純な事実・相場・手順の質問、計算や文章作成などの作業依頼、あいさつや雑談)なら worlds は空配列にする
- axes: この相談でいちばん問われている観点を、次の4つから2つ選ぶ: "time"(判断の前提になる事実と、将来どう見えるか) / "heart"(言葉の裏の気持ちと、本人が目を背けているかもしれないこと) / "motion"(見えていない危うさと、次の具体的な一手) / "soul"(本人の味方としての受け止めと、本当に大切にしているもの)
- mode: 相談の答えが法律・制度・手続き・事実で決まるもの(「有給はもらえる?」「辞めさせないと言われた」「申告は必要?」のように、権利・義務・手続きの正解がある)なら "check"、それ以外(人生の選択・人間関係・迷い・作業依頼・雑談)は "explore"。"check" のときは worlds を空配列にし、research で確かめる事実を必ず挙げる
あわせて、答えの判断に関わる事実を公的・公開の情報で確かめるための research を出す(世界が空でも出してよい):
- laws: 相談が法律上の権利・義務・手続き(退職・解雇・残業代・有給・育休・敷金・届出・税の申告など)そのものを問うときだけ、その答えを直接定める条文の法令の正式名称と条番号(例 {"law":"労働基準法","article":"20"}、枝番は "61の4")。条番号に確信があるものだけ。定義規定や周辺の条文は挙げない。人生の選択の相談では空にする。最大2
- topics: 背景を確かめたい用語・制度の Wikipedia の記事名になりそうな名詞(例 "育児休業"、"個人事業主")。最大2
- web: 最新の相場・価格・今年の制度変更・最近の出来事が判断を左右するときだけ、短い検索語。最大1
- 検索語には相談者を特定できる情報(名前・会社名・学校名・細かい地名・金額の組合せ)を入れない。一般的な言葉だけにする
- 気持ちや人間関係だけの相談など、確かめる事実がなければ research は null
出力は次のJSONのみ(前置き禁止):
{"mode":"explore" | "check","axes":["time" | "heart" | "motion" | "soul", "..."],"worlds":[{"name":"","daily":""}],"research":{"laws":[{"law":"","article":""}],"topics":[""],"web":[""]} | null}`;
}

// モデルの回答から世界の一覧を取り出す。空配列は「世界を立てない」、null は失敗。
export function parseWorlds(raw: string): World[] | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let o: unknown;
  try {
    o = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  const list = (o as { worlds?: unknown })?.worlds;
  if (!Array.isArray(list)) return null;
  const out: World[] = [];
  const seen = new Set<string>();
  for (const el of list) {
    if (el === null || typeof el !== "object") continue;
    const e = el as Record<string, unknown>;
    const name = typeof e.name === "string" ? e.name.trim().slice(0, NAME_MAX) : "";
    const daily = typeof e.daily === "string" ? e.daily.trim().slice(0, DAILY_MAX) : "";
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, daily });
    if (out.length >= WORLD_COUNT) break;
  }
  return out;
}

// 同じ出力から探求のしかたを取り出す。読めなければ従来どおり explore
export function parseMode(raw: string): InquiryMode {
  return /"mode"\s*:\s*"check"/.test(raw) ? "check" : "explore";
}

// 同じ出力から、いちばん問われている2つの軸を取り出す(重複・不正は捨てる。2つそろわなければ null)
export function parseAxes(raw: string): AxisId[] | null {
  const m = raw.match(/"axes"\s*:\s*\[([^\]]*)\]/);
  if (!m) return null;
  const ids = [...new Set(m[1].match(/"(time|heart|motion|soul)"/g)?.map((x) => x.replace(/"/g, "") as AxisId) ?? [])];
  return ids.length >= 2 ? ids.slice(0, 2) : null;
}

// 同じ出力から「何を調べるか」を取り出す(壊れていれば null)
export function parseResearch(raw: string): ResearchPlan | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return parseResearchPlan((JSON.parse(raw.slice(start, end + 1)) as { research?: unknown }).research);
  } catch {
    return null;
  }
}

// 世界を選ぶ(あわせて何を調べるかも決める)。WORLDS="on" のときだけ呼ぶ。空配列・失敗なら世界なしで進める。
// count は起動する腕の数(light=4, deep=8)。必要な数だけ選ばせて待ち時間を抑える。
export async function pickWorlds(
  input: string,
  count: number,
  opts: { env: Env; collector?: CostSink; signal?: AbortSignal },
): Promise<WorldsPlan> {
  try {
    const res = await callModel(
      "worlds",
      [
        { role: "system", content: worldsSystem(Math.min(count, WORLD_COUNT)) },
        { role: "user", content: input },
      ],
      { env: opts.env, collector: opts.collector, signal: opts.signal },
    );
    const mode = parseMode(res.text);
    return {
      // 照合モードでは世界を立てない(モデルが世界を返しても使わない)
      worlds: mode === "check" ? [] : (parseWorlds(res.text)?.slice(0, count) ?? null),
      research: parseResearch(res.text),
      mode,
      axes: parseAxes(res.text),
    };
  } catch {
    return { worlds: null, research: null, mode: "explore" };
  }
}

// 世界を使う設定か(wrangler vars の WORLDS)
export function worldsEnabled(env: Env): boolean {
  return env.WORLDS === "on";
}

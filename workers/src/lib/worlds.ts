// 視点の世界(worlds)。相談ごとに、8つの腕が立つ「違う世界」を選ぶ。
// 腕の見方(論理・盾・鏡…)は同じでも、立つ世界が違えば当たり前・大事なもの・例えが違う。
// 1つのモデルが最善の答えに向かうと寄りがちな「相談に近い常識的な視点」から離れ、
// 同じ問いを別の世界から探求した結果を持ち寄らせるための仕掛け。
// - 世界は相談のテーマに通じるものだけ(関係のない世界は雑音になる)
// - 職業名だけでなく、その世界で日々向き合っている判断や制約を書かせる(浅い役柄を避ける)
// - 単純な質問・作業依頼・雑談には世界を立てない(空配列)
// 失敗・不正応答は null(世界なしで従来どおり動く)。全呼び出しは callModel 経由(絶対ルール5)。

import { callModel } from "./callModel.js";
import type { CostSink, Env, World } from "../types.js";

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
出力は次のJSONのみ(前置き禁止):
{"worlds":[{"name":"","daily":""}]}`;
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

// 世界を選ぶ。WORLDS="on" のときだけ呼ぶ。空配列・失敗なら世界なしで進める。
// count は起動する腕の数(light=4, deep=8)。必要な数だけ選ばせて待ち時間を抑える。
export async function pickWorlds(
  input: string,
  count: number,
  opts: { env: Env; collector?: CostSink; signal?: AbortSignal },
): Promise<World[] | null> {
  try {
    const res = await callModel(
      "worlds",
      [
        { role: "system", content: worldsSystem(Math.min(count, WORLD_COUNT)) },
        { role: "user", content: input },
      ],
      { env: opts.env, collector: opts.collector, signal: opts.signal },
    );
    return parseWorlds(res.text)?.slice(0, count) ?? null;
  } catch {
    return null;
  }
}

// 世界を使う設定か(wrangler vars の WORLDS)
export function worldsEnabled(env: Env): boolean {
  return env.WORLDS === "on";
}

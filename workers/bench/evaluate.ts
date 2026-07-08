// 評価スクリプト: A・Bどちらにも使っていない別系統モデルでブラインド相対採点。
// 提示順はシード付き乱数(問ごとに独立)でランダム化し、ログに出す。既存 eval はスキップ。

import {
  ensureRawDir,
  evaluatePair,
  fileExists,
  isMain,
  loadQuestions,
  mulberry32,
  rawPath,
  readJson,
  scoreTotal,
  writeJson,
  type EvalResult,
  type SideAResult,
  type SideBResult,
} from "./lib.js";
import { BLIND_SEED, BOUNDARY_IDS } from "./config.js";

export async function evaluate(): Promise<void> {
  await ensureRawDir();
  const questions = await loadQuestions();

  for (const q of questions) {
    const evalPath = rawPath(`eval_${q.id}.json`);
    if (await fileExists(evalPath)) {
      console.log(`[eval] skip ${q.id}`);
      continue;
    }

    const a = await readJson<SideAResult>(rawPath(`${q.id}_a.json`));
    const b = await readJson<SideBResult>(rawPath(`${q.id}_b.json`));

    // ブラインド: 問ごとに独立シードで提示順を決める(再開しても順序不変)
    const rand = mulberry32(BLIND_SEED + q.id);
    const aFirst = rand() < 0.5;
    const order: ["a" | "b", "a" | "b"] = aFirst ? ["a", "b"] : ["b", "a"];
    console.log(
      `[eval] ${q.id} blind order = position1:${order[0]} position2:${order[1]}`,
    );

    const first = aFirst ? a.answer : b.answer;
    const second = aFirst ? b.answer : a.answer;
    const res = await evaluatePair(q, first, second);

    // position → a/b に戻す
    const aScore = aFirst ? res.position1 : res.position2;
    const bScore = aFirst ? res.position2 : res.position1;
    const aHonest = aFirst ? res.honest1 : res.honest2;
    const bHonest = aFirst ? res.honest2 : res.honest1;

    const totals = { a: scoreTotal(aScore), b: scoreTotal(bScore) };
    const winner: EvalResult["winner"] =
      totals.a > totals.b ? "a" : totals.b > totals.a ? "b" : "tie";

    const evalRes: EvalResult = {
      id: q.id,
      order,
      scores: { a: aScore, b: bScore },
      totals,
      winner,
    };
    if (BOUNDARY_IDS.includes(q.id)) {
      evalRes.boundary = { a: aHonest, b: bHonest };
    }
    await writeJson(evalPath, evalRes);
  }
  console.log("[eval] 完了");
}

if (isMain(import.meta.url)) {
  evaluate().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

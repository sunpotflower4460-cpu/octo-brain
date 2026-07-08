// 実行スクリプト: 各問について A(OctoBrain) と B(単発上位) の回答を取得し raw に保存。
// 直列実行 + ウェイト。既存 raw はスキップ(途中再開可)。

import {
  ensureRawDir,
  fileExists,
  isMain,
  loadQuestions,
  rawPath,
  runOctoBrain,
  runSingle,
  sleep,
  writeJson,
} from "./lib.js";
import { MOCK, REQUEST_WAIT_MS } from "./config.js";

export async function run(): Promise<void> {
  await ensureRawDir();
  const questions = await loadQuestions();
  console.log(`[run] ${questions.length}問 / MOCK=${MOCK ? "1" : "0"}`);

  for (const q of questions) {
    const aPath = rawPath(`${q.id}_a.json`);
    const bPath = rawPath(`${q.id}_b.json`);

    if (await fileExists(aPath)) {
      console.log(`[run] skip A ${q.id}`);
    } else {
      console.log(`[run] A(OctoBrain) ${q.id} ...`);
      await writeJson(aPath, await runOctoBrain(q));
      if (!MOCK) await sleep(REQUEST_WAIT_MS);
    }

    if (await fileExists(bPath)) {
      console.log(`[run] skip B ${q.id}`);
    } else {
      console.log(`[run] B(single) ${q.id} ...`);
      await writeJson(bPath, await runSingle(q));
      if (!MOCK) await sleep(REQUEST_WAIT_MS);
    }
  }
  console.log("[run] 完了");
}

if (isMain(import.meta.url)) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

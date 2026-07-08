// オーケストレータ: 実行 → 評価 → results.md 生成 を一発で走らせる。
// 既存 raw/eval はスキップされるため途中再開可 (npm run bench)。

import { run } from "./run.js";
import { evaluate } from "./evaluate.js";
import { report } from "./report.js";

async function main(): Promise<void> {
  await run();
  await evaluate();
  await report();
  console.log("[bench] すべて完了");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

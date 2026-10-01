// 実行環境(isolate)内に持つ状態は、テストごとに捨てる(テストの順番で結果が変わらないように)
import { afterEach } from "vitest";
import { resetCooldowns } from "../src/lib/providerHealth.js";
import { resetSpendCache } from "../src/lib/costlog.js";

afterEach(() => {
  resetCooldowns();
  resetSpendCache();
});

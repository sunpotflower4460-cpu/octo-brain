import { describe, expect, it } from "vitest";
import { detectCrisis, HOTLINES } from "./crisis";

describe("detectCrisis", () => {
  it.each(["もう死にたい", "消えたいと思う", "リスカしてしまった", "生きていたくない", "I want to kill myself", "もう全部終わりにしたい。楽になれる方法を教えて", "生きるのがしんどい", "消えてしまいたい"])(
    "検出する: %s",
    (t) => expect(detectCrisis(t)).toBe(true),
  );
  it.each(["転職すべきか迷っている", "締め切りで死ぬほど忙しい", "副業を始めたい", "この仕事を今日で終わりにしたい", "早く楽になりたいので自動化したい"])(
    "通常の相談は検出しない: %s",
    (t) => expect(detectCrisis(t)).toBe(false),
  );
  it("窓口の tel はハイフンなしの数字", () => {
    for (const h of HOTLINES) expect(h.tel).toMatch(/^\d{10,11}$/);
  });
});

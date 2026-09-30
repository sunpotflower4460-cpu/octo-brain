import { describe, expect, it } from "vitest";
import { detectCrisis, HOTLINES } from "./crisis";

describe("detectCrisis(通信失敗時の予備・危機レベルのみ)", () => {
  it.each(["リスカしてしまった", "I want to kill myself", "楽になれる方法を教えて", "自殺を考えている"])(
    "検出する: %s",
    (t) => expect(detectCrisis(t)).toBe(true),
  );
  it.each(["マジ辛くて消えたい", "転職すべきか迷っている", "締め切りで死ぬほど忙しい", "もう全部終わりにしたい"])(
    "軽い吐露や通常の相談では出さない: %s",
    (t) => expect(detectCrisis(t)).toBe(false),
  );
  it("窓口の tel はハイフンなしの数字", () => {
    for (const h of HOTLINES) expect(h.tel).toMatch(/^\d{10,11}$/);
  });
});

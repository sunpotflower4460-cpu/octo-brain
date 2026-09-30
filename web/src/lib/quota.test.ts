import { describe, expect, it } from "vitest";
import { quotaNote, quotaSummary } from "./quota";

describe("利用回数の見える化", () => {
  it("余裕があるときは何も出さない", () => {
    expect(quotaNote({ used: 10, limit: 100, dayUsed: 3, dayLimit: 20 })).toBeNull();
    expect(quotaNote(null)).toBeNull();
  });
  it("今日の残りが少なければ今日の残りを出す", () => {
    expect(quotaNote({ used: 10, limit: 100, dayUsed: 16, dayLimit: 20 })).toBe("今日の残り 4回分");
  });
  it("今月の残りが先に尽きるなら今月の残りを出す", () => {
    expect(quotaNote({ used: 95, limit: 100, dayUsed: 2, dayLimit: 20 })).toBe("今月の残り 5回分");
  });
  it("設定画面の表示", () => {
    expect(quotaSummary({ used: 12, limit: 100, dayUsed: 4, dayLimit: 20 })).toBe("今日 4/20回分 ・ 今月 12/100回分");
  });
});

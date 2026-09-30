import { describe, expect, it } from "vitest";
import { careDirective, detectCare } from "../src/lib/care.js";
import { buildSynthUserText } from "../src/lib/synthesize.js";

describe("detectCare", () => {
  it.each(["もう全部終わりにしたい。楽になれる方法を教えて", "消えてしまいたい", "I want to die"])("crisis: %s", (t) =>
    expect(detectCare(t)).toBe("crisis"),
  );
  it.each(["胸が締め付けられるように痛くて、左腕もしびれています", "父の意識がない", "ろれつが回らない"])(
    "medical_emergency: %s",
    (t) => expect(detectCare(t)).toBe("medical_emergency"),
  );
  it.each(["転職すべきか迷っている", "締め切りで死ぬほど忙しい", "胸が高鳴る新しい仕事"])("通常: %s", (t) =>
    expect(detectCare(t)).toBeNull(),
  );
});

describe("寄り添いモードの指示", () => {
  it("危機では、案内から入らず向き合い、窓口は選択肢として後半に添える指示を統合脳に渡す", () => {
    const text = buildSynthUserText("もう消えたい", "", []);
    expect(text).toContain("[寄り添いモード]");
    expect(text).toContain("書き出しで注意喚起や相談窓口の案内から入らない");
    expect(text).toContain("はい/いいえで答えさせない");
  });
  it("通常の相談には付けない", () => {
    expect(buildSynthUserText("転職すべきか", "", [])).not.toContain("[寄り添いモード]");
    expect(careDirective(null)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { careDirective, detectCare, shouldOfferSupport } from "../src/lib/care.js";
import { buildSynthUserText } from "../src/lib/synthesize.js";

describe("detectCare(重さの段階)", () => {
  it.each([
    "もう全部終わりにしたい。楽になれる方法を教えて",
    "リスカがやめられない",
    "薬を貯めてる。本気で死にたい",
    "自殺を考えている",
    "how to die painlessly",
  ])("危機(crisis): %s", (t) => expect(detectCare(t)).toBe("crisis"));
  it.each(["マジ辛くて消えたい", "死にたいくらい疲れた", "もう全部終わりにしたい", "I want to die"])(
    "吐露(distress): %s",
    (t) => expect(detectCare(t)).toBe("distress"),
  );
  it.each(["胸が締め付けられるように痛くて、左腕もしびれています", "ろれつが回らない"])(
    "急病(medical_emergency): %s",
    (t) => expect(detectCare(t)).toBe("medical_emergency"),
  );
  it.each(["転職すべきか迷っている", "締め切りで死ぬほど忙しい", "胸が高鳴る新しい仕事"])("通常: %s", (t) =>
    expect(detectCare(t)).toBeNull(),
  );
});

describe("窓口を添えるか(shouldOfferSupport)", () => {
  it("危機は常に添える", () => expect(shouldOfferSupport("crisis", 0, "本文")).toBe(true));
  it("軽い吐露の1回目は添えない", () => expect(shouldOfferSupport("distress", 0, "話を聞かせて")).toBe(false));
  it("吐露が同じ会話で2回目以降なら添える", () => expect(shouldOfferSupport("distress", 1, "本文")).toBe(true));
  it("1回目でも、統合脳が深刻と判断して本文で窓口に触れたら添える", () =>
    expect(shouldOfferSupport("distress", 0, "よりそいホットライン(0120-279-338)もあります")).toBe(true));
  it("急病・通常では添えない", () => {
    expect(shouldOfferSupport("medical_emergency", 3, "")).toBe(false);
    expect(shouldOfferSupport(null, 3, "")).toBe(false);
  });
});

describe("寄り添い方の指示", () => {
  it("吐露の1回目は、聴くことに徹し、窓口は原則出さない指示", () => {
    const d = careDirective("distress", 0)!;
    expect(d).toContain("[寄り添いモード・聴く]");
    expect(d).toContain("原則として出さない");
  });
  it("吐露の2回目以降は、一度だけ選択肢として添えてよい指示", () => {
    expect(careDirective("distress", 1)).toContain("一度だけ");
  });
  it("危機では案内から入らず、後半に選択肢として添える指示", () => {
    const text = buildSynthUserText("自殺したい", "", []);
    expect(text).toContain("[寄り添いモード]");
    expect(text).toContain("書き出しで注意喚起や相談窓口の案内から入らない");
  });
  it("通常の相談には付けない", () => {
    expect(buildSynthUserText("転職すべきか", "", [])).not.toContain("寄り添いモード");
  });
});

describe("疲れ・限界の短い吐露(venting)", () => {
  it.each(["もう無理、疲れた。全部投げ出したい", "しんどい", "今日は本当に疲れた"])("venting: %s", (t) =>
    expect(detectCare(t)).toBe("venting"),
  );
  it.each(["仕事に疲れた。転職すべき?", "疲れたときにおすすめの過ごし方を教えて"])("相談の形なら通常: %s", (t) =>
    expect(detectCare(t)).toBeNull(),
  );
  it("危機の確認・窓口から入らない指示で、窓口は出さない", () => {
    expect(careDirective("venting")).toContain("危機として扱わない");
    expect(shouldOfferSupport("venting", 3, "話を聞かせて")).toBe(false);
  });
});

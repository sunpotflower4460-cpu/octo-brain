import { describe, expect, it } from "vitest";
import { polishAnswer } from "../src/lib/polish.js";
import { detectBoundary } from "../src/lib/boundary.js";

describe("polishAnswer", () => {
  it("入力の一部の引用はそのまま(括弧の種類・空白・全角?の違いは許す)", () => {
    const input =
      "App Storeの紹介文を直したい。今は『このアプリは8つのAIが並列で考えて統合します。すごいです。』と書いているが、" +
      "伝わっていない気がする。誰に向けて書けばいいかも迷っている。";
    const ans = "「このアプリは8つのAIが並列で考えて統合します。すごいです。」\n\n本文";
    expect(polishAnswer(ans, input)).toEqual({ text: ans, fixes: [] });
  });

  it("入力をほぼ丸ごと繰り返すだけの引用は外す(相談文は画面のすぐ上にある)", () => {
    const input = "上司が手柄を横取りする。どう対処すべき?";
    expect(polishAnswer("「上司が手柄を横取りする。どう対処すべき?」\n\n本文", input).text).toBe("本文");
  });

  it("入力に無い引用(腕の意見など)で始まるなら、その段落を外す", () => {
    const r = polishAnswer("「会話データの保存が審査を左右する」\n\n本文です。", "AIチャットアプリの落とし穴は?");
    expect(r.text).toBe("本文です。");
    expect(r.fixes).toContain("misquote_removed");
  });

  it("英語の引用も判定する", () => {
    const input = "Should I quit? I have 3 months of savings.";
    expect(polishAnswer("“I have 3 months of savings.”\n\nBody", input).fixes).toEqual([]);
  });

  it("アラビア語の疑問符・ゼロ幅文字を直す", () => {
    const r = polishAnswer("一致していますか؟​", "x");
    expect(r.text).toBe("一致していますか？");
    expect(r.fixes).toContain("odd_chars_fixed");
  });
});

describe("最新情報の検出(境界の正直さ)", () => {
  it.each(["今週発表された主要なAIモデルのニュースをまとめて", "最近リリースされたスマホは?", "ニュースを要約して"])(
    "検出する: %s",
    (t) => expect(detectBoundary(t)).toBe("recency"),
  );
  it("通常の相談は検出しない", () => {
    expect(detectBoundary("今週、上司に相談すべきか迷っている")).toBeNull();
  });
});

describe("回答言語の判定", async () => {
  const { answerLanguage, languageDirective } = await import("../src/lib/language.js");
  it("英語の入力は en、日本語や記号だけは ja", () => {
    expect(answerLanguage("Should I quit my job to start a startup?")).toBe("en");
    expect(answerLanguage("転職すべき? AI startup")).toBe("ja");
    expect(answerLanguage("あ")).toBe("ja");
    expect(answerLanguage("27×43")).toBe("ja");
  });
  it("英語なら統合脳への指示を付け、日本語なら付けない", () => {
    expect(languageDirective("Should I quit my job?")).toContain("English");
    expect(languageDirective("転職すべき?")).toBeNull();
  });
});

describe("寄り添いモードでは冒頭の引用を外す", () => {
  it("入力にある引用でも、dropOpeningQuote なら外す", () => {
    const input = "消えたいって毎晩思う";
    const r = polishAnswer("「消えたいって毎晩思う」\n\n話してくれてありがとう。", input, { dropOpeningQuote: true });
    expect(r.text).toBe("話してくれてありがとう。");
    // 通常モードなら、長い入力の一部の引用は残る
    const longInput = "仕事でミスが続いていて、家族にも迷惑をかけている。消えたいって毎晩思う。どうしたらいいのか分からない。";
    expect(polishAnswer("「消えたいって毎晩思う」\n\n本文", longInput).text).toContain("「消えたい");
  });
});

describe("LeadingQuoteFilter(ストリーム中の冒頭引用を流さない)", async () => {
  const { LeadingQuoteFilter } = await import("../src/lib/polish.js");
  const run = (chunks: string[]) => {
    const f = new LeadingQuoteFilter();
    return chunks.map((c) => f.push(c)).join("") + f.flush();
  };
  it("引用段落が細切れに届いても捨て、本文だけを流す", () => {
    expect(run(["「消え", "たいって", "毎晩思う」", "\n\n", "話して", "くれて"])).toBe("話してくれて");
  });
  it("引用で始まらなければそのまま", () => {
    expect(run(["話して", "くれて"])).toBe("話してくれて");
  });
  it("閉じない引用はためすぎず最後に流す", () => {
    expect(run(["「閉じない引用", "のまま終わる"])).toBe("「閉じない引用のまま終わる");
  });
});

describe("境界の但し書きの誤判定を防ぐ", () => {
  it("電話番号・日付・番地は計算と見なさない", () => {
    expect(detectBoundary("私の電話番号は090-1234-5678です")).toBeNull();
    expect(detectBoundary("2026-09-30に面接がある")).toBeNull();
    expect(detectBoundary("27×43を計算して")).toBe("math");
    expect(detectBoundary("100 - 37 はいくつ")).toBe("math");
  });
  it("天気の雑談には最新情報の但し書きを付けず、尋ねたときだけ付ける", () => {
    expect(detectBoundary("今日はいい天気ですね")).toBeNull();
    expect(detectBoundary("今日の天気は?")).toBe("recency");
  });
});

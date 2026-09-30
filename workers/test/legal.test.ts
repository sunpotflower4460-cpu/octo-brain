import { describe, expect, it } from "vitest";
import app from "../src/index.js";
import { markdownToHtml } from "../src/legal/render.js";

// App Store 提出に必要な公開URL(プライバシーポリシー・利用規約・サポート)。
describe("法務文書ページ", () => {
  for (const [path, heading] of [
    ["/legal/privacy", "プライバシーポリシー"],
    ["/legal/terms", "利用規約"],
    ["/support", "サポート"],
  ] as const) {
    it(`${path} が HTML で返り、未記入のプレースホルダーが無い`, async () => {
      const res = await app.request(path, {}, {});
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      const html = await res.text();
      expect(html).toContain(`<h1>${heading}`);
      expect(html).not.toMatch(/要記入|SET_ME/);
    });
  }

  it("プライバシーポリシーに外部送信先(DeepSeek・中国)が明記されている(5.1.2(i))", async () => {
    const html = await (await app.request("/legal/privacy", {}, {})).text();
    expect(html).toContain("DeepSeek");
    expect(html).toContain("中華人民共和国");
  });
});

describe("markdownToHtml", () => {
  it("HTML をエスケープし、javascript: リンクは作らない", () => {
    const html = markdownToHtml("<script>x</script> [a](javascript:alert(1)) [b](/legal/terms)");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('<a href="/legal/terms">b</a>');
  });

  it("見出し・箇条書き・太字", () => {
    const html = markdownToHtml("## 見出し\n\n- **太字** です\n  - 入れ子");
    expect(html).toContain("<h2>見出し</h2>");
    expect(html).toContain("<li><strong>太字</strong> です</li>");
    expect(html).toContain('<li class="sub">入れ子</li>');
  });
});

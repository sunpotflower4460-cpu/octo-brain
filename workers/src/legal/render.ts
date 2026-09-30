// 法務文書(workers/legal/*.md)を、App Store 提出用の公開URLとして HTML で返す。
// 文書は見出し・段落・箇条書き・太字・リンクだけで書くので、依存を増やさず最小の変換にする。
// 入力は自前の Markdown(ユーザー入力ではない)だが、念のため HTML はすべてエスケープする。

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// 行内: **太字** / [text](url)(http(s) と / 始まりのみリンク化)/ 裸の https URL
function inline(s: string): string {
  let out = escapeHtml(s);
  out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/)[^\s)]+)\)/g, '<a href="$2">$1</a>');
  return out;
}

export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const html: string[] = [];
  let list: "ul" | null = null;
  let para: string[] = [];

  const flushPara = () => {
    if (para.length > 0) {
      html.push(`<p>${para.map(inline).join("<br>")}</p>`);
      para = [];
    }
  };
  const closeList = () => {
    if (list) {
      html.push(`</${list}>`);
      list = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const li = /^\s*-\s+(.*)$/.exec(line);
    if (line.trim() === "") {
      flushPara();
      closeList();
    } else if (h) {
      flushPara();
      closeList();
      const level = h[1].length;
      html.push(`<h${level}>${inline(h[2])}</h${level}>`);
    } else if (li) {
      flushPara();
      if (!list) {
        html.push("<ul>");
        list = "ul";
      }
      const nested = /^\s{2,}-/.test(line);
      html.push(`<li${nested ? ' class="sub"' : ""}>${inline(li[1])}</li>`);
    } else {
      closeList();
      para.push(line);
    }
  }
  flushPara();
  closeList();
  return html.join("\n");
}

export function legalPage(title: string, md: string): string {
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#1a1d24;--muted:#5b6170;--line:#e3e5ea;--link:#5b3fd6}
@media (prefers-color-scheme:dark){:root{--bg:#050711;--fg:#e8eaf0;--muted:#9aa0ad;--line:#23283a;--link:#b3a4ff}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.8 -apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP",sans-serif}
main{max-width:720px;margin:0 auto;padding:32px 16px 64px}
h1{font-size:1.5rem;line-height:1.4;margin:0 0 16px}
h2{font-size:1.1rem;margin:32px 0 8px;padding-top:16px;border-top:1px solid var(--line)}
p,li{color:var(--fg)}ul{padding-left:1.3em}li.sub{list-style:circle;margin-left:1.2em;color:var(--muted)}
a{color:var(--link);word-break:break-all}
</style>
</head>
<body><main>
${markdownToHtml(md)}
</main></body>
</html>`;
}

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// 回答の安全な Markdown 表示 (P2.7 §7.2)。生HTMLは許可しない。
// react-markdown はデフォルトで HTML を無効化するため XSS 安全。リンクは外部扱い。
export default function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
              <span aria-hidden> ↗</span>
            </a>
          ),
          // AI 出力内の画像は読み込まない(外部サーバーへの意図しない通信・追跡を防ぐ)。代替テキストだけ出す
          img: ({ alt }) => (alt ? <span className="text-[var(--text-muted)]">[画像: {alt}]</span> : null),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

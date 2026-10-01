import type { SourceRef } from "../../types";

// 調べて確かめた資料(法令・百科事典・ウェブ)。回答の根拠を相談者が自分で確かめられるように出す。
const KIND_LABEL: Record<SourceRef["kind"], string> = {
  law: "法令",
  wiki: "百科事典",
  web: "ウェブ",
};

export default function SourcesList({ sources }: { sources: SourceRef[] }) {
  if (sources.length === 0) return null;
  return (
    <section aria-label="調べた資料" className="mt-3 px-1">
      <div className="text-[11px] font-semibold text-[var(--text-muted)]">調べた資料</div>
      <ul className="mt-1 space-y-1">
        {sources.map((s) => (
          <li key={s.url} className="text-[12px] leading-snug">
            <span className="mr-1.5 rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
              {KIND_LABEL[s.kind]}
            </span>
            <a href={s.url} target="_blank" rel="noreferrer noopener" className="text-[var(--cyan-soft)] underline underline-offset-2">
              {s.title}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

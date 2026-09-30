import { Phone } from "lucide-react";
import { HOTLINES } from "../../lib/crisis";

// 危機的な内容を検出したとき、回答の前に出す相談窓口 (App Review 1.4.1 / 安全)。
// 分析よりも先に、ひとりで抱えないための連絡先を示す。
export default function CrisisSupport() {
  return (
    <aside
      role="note"
      aria-label="相談窓口のご案内"
      className="rounded-[var(--radius)] border border-[var(--cyan)]/40 bg-[var(--surface-1)] p-4 text-sm"
    >
      <p className="font-semibold text-[var(--text-primary)]">ひとりで抱えないでください</p>
      <p className="mt-1 text-[var(--text-secondary)] leading-relaxed">
        つらい気持ちを話せる窓口があります。今すぐ危険がある場合は 119 番に電話してください。
      </p>
      <ul className="mt-3 space-y-1.5">
        {HOTLINES.map((h) => (
          <li key={h.tel}>
            <a
              href={`tel:${h.tel}`}
              className="flex items-center gap-2 min-h-[44px] px-3 rounded-[var(--radius-sm)] bg-[var(--surface-2)] text-[var(--text-primary)]"
            >
              <Phone className="w-4 h-4 flex-shrink-0 text-[var(--cyan)]" aria-hidden />
              <span className="flex-1">
                {h.name}
                <span className="block text-xs text-[var(--text-muted)]">{h.hours}</span>
              </span>
              <span className="font-mono text-[var(--cyan)]">{h.display}</span>
            </a>
          </li>
        ))}
      </ul>
    </aside>
  );
}

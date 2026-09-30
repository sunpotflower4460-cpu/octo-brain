import { Phone } from "lucide-react";
import { HOTLINES } from "../../lib/crisis";

// つらさを打ち明けた相談の回答の後ろに、声で話せる場所を選択肢として添える (App Review 1.4.1)。
// 「危険と判定されて案内だけ出された」と感じさせないよう、回答より前には出さず、命令口調にしない。
export default function CrisisSupport() {
  return (
    <aside
      role="note"
      aria-label="声で話せる場所"
      className="rounded-[var(--radius)] border border-[var(--line-soft)] bg-[var(--surface-1)] p-4 text-sm"
    >
      <p className="font-semibold text-[var(--text-primary)]">声で話したくなったときに</p>
      <p className="mt-1 text-[var(--text-secondary)] leading-relaxed">
        ここで話し続けてもかまいません。誰かの声を聞きたくなったら、こんな場所もあります。
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
      <p className="mt-3 text-xs text-[var(--text-muted)] leading-relaxed">
        いますぐ身の危険があるときは、119 番につながります。
      </p>
    </aside>
  );
}

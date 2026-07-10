import { useState } from "react";
import { ChevronRight, Square } from "lucide-react";
import LensOrbit from "./LensOrbit";
import { lensProgress, type ThoughtTrace } from "../../lib/cognition";
import { MAIN_STEPS, presentPhase } from "../../lib/phasePresentation";

// 思考進行 (P2.7 §6.3 / ユーザー要望で「回答が主役」へ調整)。
// 完了後は表示しない(回答を普通のチャットのように主役にする。詳細は下の「8つの視点」や
// InsightCard の「処理の詳細」で開ける)。処理中のみ1行のコンパクト表示 + 開いて詳細。
export default function ProcessDock({
  trace,
  onStop,
  defaultOpen = false,
}: {
  trace: ThoughtTrace;
  onStop?: () => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  const finished =
    trace.phase === "done" || trace.phase === "cancelled" || trace.phase === "error";
  if (finished) return null;

  const p = presentPhase(trace.phase);
  const { done, active } = lensProgress(trace);
  const stepActive = p.step;

  return (
    <section
      className="mb-3 rounded-[var(--radius)] border border-[var(--line-soft)] bg-[var(--surface-1)]/70 px-3 py-2"
      aria-label="思考の進行"
    >
      <div className="flex items-center gap-2">
        <span
          className="w-2 h-2 rounded-full bg-[var(--cyan)] animate-pulse flex-shrink-0"
          aria-hidden
        />
        <span className="text-[13px] font-semibold text-[var(--text-primary)]">
          {p.name}
        </span>
        <span className="text-[12px] font-mono text-[var(--text-muted)]">
          完了 {done}/{active || "…"}
        </span>

        {onStop && (
          <button
            type="button"
            onClick={onStop}
            className="ml-auto inline-flex items-center gap-1 min-h-[32px] px-2.5 rounded-full text-[11px] font-semibold border border-[var(--line-strong)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--danger)]/60 transition-colors"
          >
            <Square className="w-3 h-3" />
            停止
          </button>
        )}
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={`inline-flex items-center gap-0.5 min-h-[32px] px-1.5 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors ${onStop ? "" : "ml-auto"}`}
        >
          <ChevronRight
            className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-90" : ""}`}
            aria-hidden
          />
          詳細
        </button>
      </div>

      {!open ? (
        <div className="mt-0.5 pl-4 text-[12px] text-[var(--text-secondary)]">
          {p.hint}
        </div>
      ) : (
        <div className="mt-2">
          <ol className="flex items-center gap-1.5 mb-2">
            {MAIN_STEPS.map((s, i) => {
              const n = i + 1;
              const state = n < stepActive ? "past" : n === stepActive ? "now" : "future";
              return (
                <li key={s.phase} className="flex items-center gap-1.5 flex-1">
                  <span
                    className={`flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-semibold ${
                      state === "now"
                        ? "bg-[var(--cyan)] text-[#04121a]"
                        : state === "past"
                          ? "bg-[var(--violet)]/40 text-[var(--text-primary)]"
                          : "border border-[var(--line-strong)] text-[var(--text-muted)]"
                    }`}
                  >
                    {n}
                  </span>
                  <span
                    className={`text-[11px] ${
                      state === "now"
                        ? "text-[var(--text-primary)] font-semibold"
                        : "text-[var(--text-muted)]"
                    }`}
                  >
                    {s.short}
                  </span>
                  {i < MAIN_STEPS.length - 1 && (
                    <span className="flex-1 h-px bg-[var(--line-soft)]" aria-hidden />
                  )}
                </li>
              );
            })}
          </ol>
          <LensOrbit trace={trace} />
        </div>
      )}
    </section>
  );
}

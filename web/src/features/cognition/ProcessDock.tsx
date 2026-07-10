import { Square } from "lucide-react";
import LensOrbit from "./LensOrbit";
import Disclosure from "../../components/Disclosure";
import {
  failedLensCount,
  lensProgress,
  type ThoughtTrace,
} from "../../lib/cognition";
import { MAIN_STEPS, presentPhase } from "../../lib/phasePresentation";

// 各回答の思考進行 (P2.7 §6.3)。上段=4段階ステップ、中段=8レンズ状態、下段=完了数+停止。
// 完了後は1行 Disclosure へ畳む。

export default function ProcessDock({
  trace,
  onStop,
}: {
  trace: ThoughtTrace;
  onStop?: () => void;
}) {
  const p = presentPhase(trace.phase);
  const { done, active } = lensProgress(trace);
  const failed = failedLensCount(trace);
  const finished =
    trace.phase === "done" || trace.phase === "error" || trace.phase === "cancelled";

  if (finished) {
    const secs =
      trace.completedAt && trace.startedAt
        ? ((trace.completedAt - trace.startedAt) / 1000).toFixed(1)
        : null;
    const headline =
      trace.phase === "done"
        ? `${active || 8}視点で思考済み${secs ? ` · ${secs}秒` : ""}`
        : trace.phase === "cancelled"
          ? "生成を停止しました"
          : "接続が途切れました";
    return (
      <div className="mb-3">
        <Disclosure summary={<span>{headline}</span>}>
          <div className="mt-2 rounded-[var(--radius-sm)] border border-[var(--line-soft)] bg-[var(--surface-1)] p-3">
            <LensOrbit trace={trace} />
            {failed > 0 && (
              <p className="mt-2 text-[12px] text-[var(--text-muted)]">
                一部の腕({failed})は返答できませんでしたが、残りで統合しました。
              </p>
            )}
          </div>
        </Disclosure>
      </div>
    );
  }

  const stepActive = p.step;
  return (
    <section
      className="mb-3 rounded-[var(--radius)] border border-[var(--line-soft)] bg-[var(--surface-1)]/80 p-3"
      aria-label="思考の進行"
    >
      {/* 4段階ステップ */}
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

      <div className="mb-2">
        <div className="text-sm font-semibold text-[var(--text-primary)]">
          {p.name}
        </div>
        <div className="text-[12px] text-[var(--text-secondary)]">{p.hint}</div>
      </div>

      {(trace.phase === "nodes" || active > 0) && (
        <div className="mb-2">
          <LensOrbit trace={trace} />
        </div>
      )}

      <div className="flex items-center gap-3">
        <span className="text-[12px] font-mono text-[var(--text-secondary)]">
          完了 {done}/{active || "…"}
        </span>
        {onStop && (
          <button
            type="button"
            onClick={onStop}
            className="ml-auto inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-full text-xs font-semibold border border-[var(--line-strong)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--danger)]/60 transition-colors"
          >
            <Square className="w-3.5 h-3.5" />
            停止
          </button>
        )}
      </div>
    </section>
  );
}

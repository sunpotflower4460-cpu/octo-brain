import { Check, Clock, Loader2, Unplug, WifiOff } from "lucide-react";
import { displayLenses, isFailStatus, lensStatusText } from "./coreView";
import type { LensUiStatus, ThoughtTrace } from "../../lib/cognition";

// 8レンズの状態を DOM で可視化 (P2.7 §6.5)。色だけに頼らずアイコン+テキストで状態を示す。
// Canvas を隠しても、これだけで全レンズ状態が理解できる(a11y・Reduced Motion対応)。

function StatusMark({ status }: { status: LensUiStatus }) {
  const base = "w-3.5 h-3.5 flex-shrink-0";
  switch (status) {
    case "done":
      return <Check className={`${base} text-[var(--success)]`} aria-hidden />;
    case "working":
    case "queued":
      return (
        <Loader2 className={`${base} text-[var(--cyan)] animate-spin`} aria-hidden />
      );
    case "timeout":
      return <Clock className={`${base} text-[var(--gold)]`} aria-hidden />;
    case "parse_error":
      return <Unplug className={`${base} text-[var(--gold)]`} aria-hidden />;
    case "error":
      return <WifiOff className={`${base} text-[var(--danger)]`} aria-hidden />;
    default:
      return (
        <span
          className={`${base} rounded-full border border-[var(--line-strong)]`}
          aria-hidden
        />
      );
  }
}

export default function LensOrbit({
  trace,
  compact = false,
}: {
  trace: ThoughtTrace | null;
  compact?: boolean;
}) {
  const lenses = displayLenses(trace);
  return (
    <ul
      className={`grid gap-1.5 ${compact ? "grid-cols-4" : "grid-cols-2 sm:grid-cols-4"}`}
      aria-label="8つのレンズの状態"
    >
      {lenses.map((l) => {
        const inactive = l.status === "inactive";
        const fail = isFailStatus(l.status);
        return (
          <li
            key={l.id}
            className={`flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-2 py-1.5 transition-colors ${
              inactive
                ? "border-[var(--line-soft)] opacity-45"
                : fail
                  ? "border-[var(--line-soft)] bg-[var(--surface-1)] opacity-70"
                  : "border-[var(--line-soft)] bg-[var(--surface-1)]"
            }`}
            title={`${l.uiName}(${l.axisLabel}): ${lensStatusText(l.status)}`}
          >
            <span className="text-sm" aria-hidden>
              {l.emoji}
            </span>
            {!compact && (
              <span className="text-xs text-[var(--text-secondary)] truncate">
                {l.uiName}
              </span>
            )}
            <span className="ml-auto flex items-center gap-1">
              <StatusMark status={l.status} />
              <span className="sr-only">{lensStatusText(l.status)}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

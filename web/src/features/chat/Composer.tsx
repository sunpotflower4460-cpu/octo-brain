import { useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import { planLabel } from "../../lib/phasePresentation";
import type { Plan } from "../../types";

const MAX = 4000;

// 問いの入口 (P2.7 §9)。複数行 textarea・IME・Enter送信/Shift+Enter改行・停止・Safe Area。
export default function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  busy,
  plan,
  onPlanChange,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  busy: boolean;
  plan: Plan;
  onPlanChange: (p: Plan) => void;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [composing, setComposing] = useState(false);

  // 1〜6行で自動伸長
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 168)}px`;
  }, [value]);

  const canSend = value.trim().length > 0 && !busy;

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !composing && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (canSend) onSubmit();
    }
  };

  return (
    <div
      className="border-t border-[var(--line-soft)] bg-[var(--bg-depth)]/85 backdrop-blur-md"
      style={{ paddingBottom: "var(--safe-bottom)" }}
    >
      <div className="mx-auto w-full max-w-[var(--read-max)] px-3 md:px-4 pt-2.5 pb-3">
        {/* モード選択 (§9.2) */}
        <div className="flex items-center gap-1 mb-2" role="radiogroup" aria-label="思考モード">
          {(["light", "deep"] as Plan[]).map((p) => {
            const l = planLabel(p);
            const on = plan === p;
            return (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={busy}
                onClick={() => !busy && onPlanChange(p)}
                title={l.desc}
                className={`min-h-[36px] px-3 rounded-full text-xs font-semibold transition-colors disabled:opacity-50 ${
                  on
                    ? "bg-[var(--violet)]/25 text-[var(--text-primary)] ring-1 ring-[var(--violet)]/50"
                    : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                }`}
              >
                {l.title}
                <span className="ml-1.5 font-normal text-[var(--text-muted)] hidden sm:inline">
                  {l.desc}
                </span>
              </button>
            );
          })}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSend) onSubmit();
          }}
          className={`flex items-end gap-2 rounded-[20px] border bg-[var(--surface-1)] px-3 py-2 transition-colors ${
            busy
              ? "border-[var(--violet)]/40"
              : "border-[var(--line-strong)] focus-within:border-[var(--cyan)]/60"
          }`}
        >
          <textarea
            ref={taRef}
            rows={1}
            value={value}
            maxLength={MAX}
            disabled={busy}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
            placeholder="決断、アイデア、本音を OctoBrain に…"
            aria-label="OctoBrain への問い"
            className="flex-1 resize-none bg-transparent border-none py-2 text-[15px] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none disabled:opacity-60 leading-relaxed max-h-[168px]"
          />
          {busy ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="生成を停止"
              className="flex-shrink-0 flex items-center justify-center w-11 h-11 rounded-full bg-[var(--surface-3)] text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors"
            >
              <Square className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSend}
              aria-label="送信"
              className="flex-shrink-0 flex items-center justify-center w-11 h-11 rounded-full bg-gradient-to-br from-[var(--cyan)] to-[var(--violet)] text-[#04121a] disabled:opacity-30 disabled:cursor-not-allowed transition-opacity"
            >
              <ArrowUp className="w-5 h-5" />
            </button>
          )}
        </form>

        {value.length > MAX - 400 && (
          <div className="mt-1 text-right text-[11px] text-[var(--text-muted)]">
            {value.length}/{MAX}
          </div>
        )}
      </div>
    </div>
  );
}

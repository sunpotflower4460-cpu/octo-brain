import { Waypoints, Link2, Loader2 } from "lucide-react";
import Markdown from "../../components/Markdown";
import { displayFor } from "../../config/nodeDisplay";
import type { AnalyzeMeta, ResonancePair } from "../../types";
import type { ChatMessage } from "../chat/message";

// 「次に、どう考える？」(P2.7 §8)。TENSION=深化(フューシャ/対立)、RESONANCE=共鳴(シアン/結合)。
// AIが強く検出した方を Primary に、もう一方を Secondary に。

export default function NextThought({
  msg,
  busy,
  deepening,
  resonating,
  onDeepen,
  onResonateAI,
}: {
  msg: ChatMessage;
  busy: boolean;
  deepening: boolean;
  resonating: boolean;
  onDeepen: () => void;
  onResonateAI: (pair: { a: ResonancePair; b: ResonancePair }) => void;
}) {
  const meta = msg.meta as AnalyzeMeta | undefined;
  const tension = meta?.tension ?? null;
  const resonance = meta?.resonance ?? null;
  if (!tension && !resonance && !msg.deepened && !(msg.resonances?.length)) return null;

  // 優先順位: resonance があればそれを Primary(結合は前向きな一手)、無ければ tension。
  const resonancePrimary = !!resonance;

  const tensionCard = tension && (
    <div
      className={`rounded-[var(--radius)] border p-3 ${
        !resonancePrimary
          ? "border-[var(--fuchsia)]/40 bg-[var(--fuchsia)]/[0.06]"
          : "border-[var(--line-soft)] bg-[var(--surface-1)]"
      }`}
    >
      <div className="flex items-center gap-2 text-[13px] text-[var(--fuchsia)]">
        <Waypoints className="w-4 h-4" aria-hidden />
        <span className="font-semibold">
          {tension.axis}に、まだ張りがあります
        </span>
      </div>
      {tension.reason && (
        <p className="mt-1 text-[12px] text-[var(--text-secondary)]">{tension.reason}</p>
      )}
      {msg.deepened ? (
        <DeepResult axis={msg.deepened.axis} answer={msg.deepened.answer} />
      ) : deepening ? (
        <Running text="対角の2本が読み直しています" />
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={onDeepen}
          className={`mt-2.5 inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-full text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
            !resonancePrimary
              ? "bg-gradient-to-r from-[var(--fuchsia)] to-[var(--violet)] text-white"
              : "border border-[var(--fuchsia)]/40 text-[var(--fuchsia)] hover:bg-[var(--fuchsia)]/10"
          }`}
        >
          <Waypoints className="w-4 h-4" />
          この緊張を深く掘る
        </button>
      )}
      {msg.deepenError && (
        <p className="mt-2 text-[11px] text-[var(--danger)]">{msg.deepenError}</p>
      )}
    </div>
  );

  const resonanceCard = resonance && (
    <div
      className={`rounded-[var(--radius)] border p-3 ${
        resonancePrimary
          ? "border-[var(--cyan)]/40 bg-[var(--cyan)]/[0.06]"
          : "border-[var(--line-soft)] bg-[var(--surface-1)]"
      }`}
    >
      <div className="flex items-center gap-2 text-[13px] text-[var(--cyan)]">
        <Link2 className="w-4 h-4" aria-hidden />
        <span className="font-semibold">遠い2つが響き合っています</span>
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
        <Pill>{displayFor(resonance.a.lens).uiName}</Pill>
        <span className="text-[var(--cyan)]">◦—◦</span>
        <Pill>{displayFor(resonance.b.lens).uiName}</Pill>
      </div>
      <p className="mt-1.5 text-[12px] text-[var(--text-muted)]">
        共通する根: {resonance.root}
      </p>
      {resonating ? (
        <Running text="2本から第三の選択肢を探しています" />
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            onResonateAI({
              a: { lens: resonance.a.lens, claim: resonance.a.claim },
              b: { lens: resonance.b.lens, claim: resonance.b.claim },
            })
          }
          className={`mt-2.5 inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-full text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
            resonancePrimary
              ? "bg-gradient-to-r from-[var(--cyan)] to-[var(--violet)] text-[#04121a]"
              : "border border-[var(--cyan)]/40 text-[var(--cyan)] hover:bg-[var(--cyan)]/10"
          }`}
        >
          <Link2 className="w-4 h-4" />
          2つを響かせる
        </button>
      )}
    </div>
  );

  return (
    <section className="mt-3">
      <h3 className="text-[12px] font-semibold text-[var(--text-muted)]">
        次に、どう考える？
      </h3>
      <p className="text-[11px] text-[var(--text-muted)] mb-2 mt-0.5">
        任意です。もう一段だけ深く掘りたいときに。
      </p>
      <div className="space-y-2">
        {resonancePrimary ? (
          <>
            {resonanceCard}
            {tensionCard}
          </>
        ) : (
          <>
            {tensionCard}
            {resonanceCard}
          </>
        )}
      </div>

      {/* ユーザー選択などの共鳴結果 */}
      {msg.resonances?.map((r, i) => (
        <div
          key={i}
          className="mt-2 rounded-[var(--radius)] border border-[var(--cyan)]/30 bg-[var(--surface-1)] p-3"
        >
          <div className="text-[11px] font-semibold text-[var(--cyan)] mb-1">
            🔗 {r.label}
          </div>
          <div className="text-[14px] text-[var(--text-primary)]">
            <Markdown>{r.answer}</Markdown>
          </div>
        </div>
      ))}
      {msg.resonateError && (
        <p className="mt-2 text-[11px] text-[var(--danger)]">{msg.resonateError}</p>
      )}
    </section>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-[var(--line-soft)] bg-[var(--surface-2)] px-2 py-0.5 text-[var(--text-primary)]">
      {children}
    </span>
  );
}

function Running({ text }: { text: string }) {
  return (
    <div className="mt-2.5 inline-flex items-center gap-1.5 text-[12px] text-[var(--text-secondary)]">
      <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
      {text}
    </div>
  );
}

function DeepResult({ axis, answer }: { axis: string; answer: string }) {
  return (
    <div className="mt-2.5 rounded-[var(--radius-sm)] border border-[var(--fuchsia)]/30 bg-[var(--surface-2)] p-3">
      <div className="text-[11px] font-semibold text-[var(--fuchsia)] mb-1">
        🐙 深掘り({axis})
      </div>
      <div className="text-[14px] text-[var(--text-primary)]">
        <Markdown>{answer}</Markdown>
      </div>
    </div>
  );
}

import { HelpCircle } from "lucide-react";

// 初回の空状態 Hero (P2.7 §5.5)。価値が5秒で伝わる。
// 「何をするアプリか」を平易な3ステップで示し、実際の問いの例をワンタップで試せる。

// ワンタップで“本物の結果”まで行ける具体的な問いにする(抽象カテゴリより伝わる)。
const EXAMPLES = [
  "転職すべきか、今の会社に残るか",
  "やりたいことが多すぎて絞れない",
  "この企画、GO か見送りか",
];

const STEPS = [
  { n: "1", t: "問いを置く" },
  { n: "2", t: "8つの視点が同時に考える" },
  { n: "3", t: "対立も含めて1つに織る" },
];

export default function Hero({
  onPick,
  onHowItWorks,
}: {
  onPick: (text: string) => void;
  onHowItWorks?: () => void;
}) {
  return (
    <div className="flex flex-col items-center text-center px-4 py-6 md:py-10">
      <h2 className="text-[26px] md:text-[32px] font-bold tracking-tight text-[var(--text-primary)]">
        OctoBrain
      </h2>
      <p className="mt-2 text-[15px] md:text-[17px] text-[var(--text-secondary)] max-w-[32ch] leading-relaxed">
        ひとつの問いを、8つの視点が同時に考える思考エンジン。
      </p>
      <p className="mt-2 text-[13px] text-[var(--text-muted)] max-w-[34ch] leading-relaxed">
        ふつうのAIが1つの答えを返すところを、対立する見方も隠さず、ひとつの理解に織り上げます。
      </p>

      {/* 平易な3ステップ — 仕組みが一目で分かる */}
      <ol className="mt-5 flex items-center gap-1.5 text-[12px]">
        {STEPS.map((s, i) => (
          <li key={s.n} className="flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line-soft)] bg-[var(--surface-1)] px-2.5 py-1">
              <span className="flex items-center justify-center w-4 h-4 rounded-full bg-[var(--cyan)]/20 text-[10px] font-semibold text-[var(--cyan)]">
                {s.n}
              </span>
              <span className="text-[var(--text-secondary)]">{s.t}</span>
            </span>
            {i < STEPS.length - 1 && (
              <span className="text-[var(--text-muted)]" aria-hidden>
                ›
              </span>
            )}
          </li>
        ))}
      </ol>

      {/* 実際の問いの例 — タップでそのまま試せる */}
      <div className="mt-6 w-full max-w-[30ch]">
        <div className="text-[11px] text-[var(--text-muted)] mb-2">例をタップして試す</div>
        <div className="flex flex-col gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => onPick(ex)}
              className="min-h-[44px] px-4 rounded-[var(--radius-sm)] text-[13px] text-left text-[var(--text-secondary)] border border-[var(--line-strong)] hover:text-[var(--text-primary)] hover:border-[var(--cyan)]/50 transition-colors"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>

      {onHowItWorks && (
        <button
          type="button"
          onClick={onHowItWorks}
          className="mt-5 inline-flex items-center gap-1.5 text-[12px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
        >
          <HelpCircle className="w-3.5 h-3.5" aria-hidden />
          使い方を見る
        </button>
      )}
    </div>
  );
}

// 初回の空状態 Hero (P2.7 §5.5)。価値が5秒で伝わる。長い起動メッセージは吹き出しにしない。

const EXAMPLES = ["決断を整理する", "アイデアを広げる", "本音を深く見る"];

export default function Hero({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex flex-col items-center text-center px-4 py-6 md:py-10">
      <h2 className="text-[26px] md:text-[32px] font-bold tracking-tight text-[var(--text-primary)]">
        OctoBrain
      </h2>
      <p className="mt-2 text-[15px] md:text-[17px] text-[var(--text-secondary)] max-w-[30ch] leading-relaxed">
        8つのレンズで観て、4つの軸で張り合い、1つの理解へ織る。
      </p>
      <p className="mt-3 text-[13px] text-[var(--text-muted)] max-w-[34ch] leading-relaxed">
        決断、アイデア、本音の整理を、ひとつのAIでは見落とす角度から考えます。
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => onPick(ex)}
            className="min-h-[40px] px-4 rounded-full text-[13px] border border-[var(--line-strong)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--cyan)]/50 transition-colors"
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}

import CoreCanvas from "./CoreCanvas";
import { buildCoreViewModel } from "./coreView";
import { lensProgress, type ThoughtTrace } from "../../lib/cognition";
import { presentPhase } from "../../lib/phasePresentation";

// 生きた中枢 (P2.7 §5.1)。Canvas(生体発光)+ DOMキャプション(現在フェーズ・完了数)。
// 左カラム(desktop)/上部パネル(mobile)に置く「思考の計器」。
export default function LivingCore({
  trace,
  reducedMotion,
  emphasis,
  variant = "working",
}: {
  trace: ThoughtTrace | null;
  reducedMotion: boolean;
  emphasis?: { ids: string[]; kind: "tension" | "resonance" };
  variant?: "hero" | "working" | "compact";
}) {
  const vm = buildCoreViewModel(trace, reducedMotion, emphasis);
  const phase = trace?.phase ?? "idle";
  const p = presentPhase(phase);
  const { done, active } = trace ? lensProgress(trace) : { done: 0, active: 0 };
  const processing =
    phase !== "idle" && phase !== "done" && phase !== "error" && phase !== "cancelled";

  const stageH = variant === "compact" ? "h-[120px]" : "h-[240px] md:h-[300px]";

  return (
    <div className="flex flex-col items-center">
      <div className={`relative w-full ${stageH}`}>
        <CoreCanvas vm={vm} />
      </div>

      <div className="mt-1 text-center min-h-[40px]">
        {processing ? (
          <>
            <div className="text-sm font-semibold text-[var(--text-primary)]">
              {p.name}
            </div>
            {active > 0 && (
              <div className="text-[12px] font-mono text-[var(--text-secondary)]">
                完了 {done}/{active}
              </div>
            )}
          </>
        ) : variant === "hero" ? (
          <div className="text-[12px] text-[var(--text-muted)]">
            8つのレンズ · 4つの緊張軸 · 1つの中央脳
          </div>
        ) : (
          <div className="text-[12px] text-[var(--text-muted)]">{p.hint}</div>
        )}
      </div>
    </div>
  );
}

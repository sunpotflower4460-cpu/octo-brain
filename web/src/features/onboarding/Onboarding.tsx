import { useState } from "react";
import CoreCanvas, { type CoreLens, type CoreViewModel } from "../cognition/CoreCanvas";
import { LENS_HUE } from "../cognition/coreView";
import { LENS_ORDER } from "../../config/nodeDisplay";
import type { UiPhase } from "../../lib/cognition";

// 初回オンボーディング3場面 (P2.7 §5.6)。Living Core が実際に反応するインタラクティブ導入。
// 1文 + 1つの動き。次へ/スキップ/問いを置いてみる。Reduced Motion では静的。

interface Scene {
  title: string;
  body: string;
  phase: UiPhase;
  emphasisIdx: number[];
}

const SCENES: Scene[] = [
  {
    title: "8本の腕",
    body: "それぞれが違う角度から、同時に観ます。",
    phase: "nodes",
    emphasisIdx: [],
  },
  {
    title: "4つの軸",
    body: "反対側の視点が張り合う場所に、深さが生まれます。",
    phase: "nodes",
    emphasisIdx: [1, 5],
  },
  {
    title: "中央脳",
    body: "一致も矛盾も消さず、ひとつの理解へ織ります。",
    phase: "synth",
    emphasisIdx: [],
  },
];

function sceneVM(scene: Scene, reducedMotion: boolean): CoreViewModel {
  const lenses: CoreLens[] = LENS_ORDER.map((id, i) => ({
    id,
    status: scene.phase === "synth" ? "done" : "working",
    emphasis: scene.emphasisIdx.includes(i) ? "tension" : "none",
    hue: LENS_HUE[id],
  }));
  return { phase: scene.phase, lenses, reducedMotion };
}

export default function Onboarding({
  reducedMotion,
  onDone,
}: {
  reducedMotion: boolean;
  onDone: () => void;
}) {
  const [i, setI] = useState(0);
  const scene = SCENES[i];
  const last = i === SCENES.length - 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--bg-abyss)]/95 backdrop-blur-sm p-6"
      role="dialog"
      aria-modal="true"
      aria-label="OctoBrain のしくみ"
    >
      <div className="w-full max-w-[420px] flex flex-col items-center text-center">
        <div className="relative w-full h-[260px]">
          <CoreCanvas vm={sceneVM(scene, reducedMotion)} />
        </div>
        <div className="mt-2 min-h-[92px]">
          <div className="text-[13px] font-mono text-[var(--cyan)] tracking-wider">
            {i + 1} / {SCENES.length}
          </div>
          <h2 className="mt-1 text-xl font-bold text-[var(--text-primary)]">{scene.title}</h2>
          <p className="mt-2 text-[15px] text-[var(--text-secondary)] leading-relaxed">
            {scene.body}
          </p>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            onClick={onDone}
            className="min-h-[44px] px-4 text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          >
            スキップ
          </button>
          {last ? (
            <button
              type="button"
              onClick={onDone}
              className="min-h-[44px] px-6 rounded-full text-sm font-semibold bg-gradient-to-r from-[var(--cyan)] to-[var(--violet)] text-[#04121a]"
            >
              問いを置いてみる
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setI((v) => v + 1)}
              className="min-h-[44px] px-6 rounded-full text-sm font-semibold bg-[var(--surface-2)] text-[var(--text-primary)] border border-[var(--line-strong)]"
            >
              次へ
            </button>
          )}
        </div>

        <div className="mt-4 flex gap-1.5" aria-hidden>
          {SCENES.map((_, n) => (
            <span
              key={n}
              className={`h-1.5 rounded-full transition-all ${
                n === i ? "w-5 bg-[var(--cyan)]" : "w-1.5 bg-[var(--line-strong)]"
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

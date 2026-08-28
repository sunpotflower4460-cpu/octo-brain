import { useEffect, useMemo, useRef } from "react";
import { LENS_ORDER } from "../../config/nodeDisplay";
import CoreCanvas, { type CoreViewModel } from "../cognition/CoreCanvas";
import { LENS_HUE } from "../cognition/coreView";

// 全画面の背後: 星のまたたき + 既存 Living Core グラフィック(CoreCanvas)を薄く漂わせる。
// 自前のタコ描画は使わず、本番と同じ CoreCanvas を流用する。
// reducedMotion 時は静止。

type Star = {
  x: number;
  y: number;
  r: number;
  base: number;
  twinkle: number;
  phase: number;
};

// 背景用: 8腕がゆっくり光る「生きた」状態。計器UIとは別インスタンス。
function ambientCoreVm(reducedMotion: boolean): CoreViewModel {
  return {
    phase: "nodes",
    reducedMotion,
    lenses: LENS_ORDER.map((id) => ({
      id,
      status: "working",
      emphasis: "none",
      hue: LENS_HUE[id],
    })),
  };
}

export default function AmbientCosmos({ reducedMotion }: { reducedMotion: boolean }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const coreVm = useMemo(() => ambientCoreVm(reducedMotion), [reducedMotion]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let stars: Star[] = [];
    let raf = 0;
    let cssW = 0;
    let cssH = 0;
    let t0 = performance.now();

    const seedStars = (w: number, h: number) => {
      const count = Math.min(140, Math.max(48, Math.floor((w * h) / 14000)));
      const next: Star[] = [];
      for (let i = 0; i < count; i++) {
        next.push({
          x: Math.random() * w,
          y: Math.random() * h,
          r: 0.4 + Math.random() * 1.4,
          base: 0.22 + Math.random() * 0.55,
          twinkle: 0.35 + Math.random() * 0.9,
          phase: Math.random() * Math.PI * 2,
        });
      }
      stars = next;
    };

    const paint = (now: number) => {
      const t = (now - t0) / 1000;
      ctx.clearRect(0, 0, cssW, cssH);

      const g = ctx.createRadialGradient(
        cssW * 0.7,
        cssH * 0.2,
        0,
        cssW * 0.7,
        cssH * 0.2,
        Math.max(cssW, cssH) * 0.7,
      );
      g.addColorStop(0, "rgba(103, 232, 249, 0.045)");
      g.addColorStop(0.45, "rgba(167, 139, 250, 0.03)");
      g.addColorStop(1, "transparent");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, cssW, cssH);

      for (const s of stars) {
        const tw = reducedMotion
          ? s.base
          : s.base * (0.55 + 0.45 * Math.sin(t * s.twinkle + s.phase));
        ctx.beginPath();
        ctx.fillStyle = `rgba(244, 247, 255, ${tw})`;
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }

      if (!reducedMotion) raf = requestAnimationFrame(paint);
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cssW = wrap.clientWidth;
      cssH = wrap.clientHeight;
      if (cssW <= 0 || cssH <= 0) return;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seedStars(cssW, cssH);
      if (reducedMotion) paint(performance.now());
    };

    resize();
    if (!reducedMotion) raf = requestAnimationFrame(paint);
    else paint(performance.now());

    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [reducedMotion]);

  return (
    <div
      ref={wrapRef}
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
      aria-hidden
    >
      <canvas ref={canvasRef} className="absolute inset-0 block w-full h-full" />
      {/* 既存 CoreCanvas を大きく・薄く・ゆっくり漂わせる */}
      <div
        className={`ambient-core absolute left-1/2 top-[52%] w-[min(96vw,820px)] aspect-square opacity-[0.34] ${
          reducedMotion ? "" : "ambient-core--drift"
        }`}
      >
        <CoreCanvas vm={coreVm} />
      </div>
    </div>
  );
}

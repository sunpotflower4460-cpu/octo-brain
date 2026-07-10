import { useEffect, useRef } from "react";
import type { LensUiStatus, UiPhase } from "../../lib/cognition";

// Living Core の描画レイヤー (P2.7 §13)。コンテナ実寸へ追従・DPR対応・可視時のみ描画。
// 中央の1つのCore + 8腕(=8レンズ)。腕ごとに status で発光が変わる = 思考の計器。
// 情報(レンズ名・状態・操作)は DOM 側(LensOrbit)が担い、ここは生体的発光を担う。

export interface CoreLens {
  id: string;
  status: LensUiStatus;
  emphasis: "none" | "tension" | "resonance";
  hue: number; // 0..360 そのレンズ固有の柔らかな色
}

export interface CoreViewModel {
  phase: UiPhase;
  lenses: CoreLens[]; // 常に8件(nodeDisplay順)
  reducedMotion: boolean;
}

const TAU = Math.PI * 2;

export default function CoreCanvas({ vm }: { vm: CoreViewModel }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vmRef = useRef(vm);
  vmRef.current = vm;

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let running = true;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let cssW = 0;
    let cssH = 0;

    const resize = () => {
      const r = wrap.getBoundingClientRect();
      cssW = Math.max(1, r.width);
      cssH = Math.max(1, r.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    const phaseAccent = (phase: UiPhase): string => {
      if (phase === "synth" || phase === "deepening") return "#a78bfa";
      if (phase === "verify") return "#f6c76e";
      if (phase === "done") return "#8ea6d8";
      return "#67e8f9";
    };

    let last = 0;
    const draw = (tms: number) => {
      if (!running) return;
      const state = vmRef.current;
      const active =
        state.phase !== "idle" &&
        state.phase !== "done" &&
        state.phase !== "error" &&
        state.phase !== "cancelled";
      // idle/完了時は省電力(低頻度)、処理中のみ滑らか
      const interval = active && !state.reducedMotion ? 0 : 140;
      if (tms - last < interval) {
        raf = requestAnimationFrame(draw);
        return;
      }
      last = tms;
      const time = state.reducedMotion ? 0 : tms / 1000;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);

      const cx = cssW / 2;
      const cy = cssH / 2;
      const R = Math.min(cssW, cssH) * 0.42;
      const coreR = Math.min(cssW, cssH) * 0.11;
      const accent = phaseAccent(state.phase);

      // 4軸の細い連結線(対角 i と i+4)
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(166,193,235,0.08)";
      for (let i = 0; i < 4; i++) {
        const a = -Math.PI / 2 + (i / 8) * TAU;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
        ctx.lineTo(cx + Math.cos(a + Math.PI) * R, cy + Math.sin(a + Math.PI) * R);
        ctx.stroke();
      }

      // 8腕
      const inward = state.phase === "synth" || state.phase === "verify";
      for (let i = 0; i < 8; i++) {
        const lens = state.lenses[i];
        const a = -Math.PI / 2 + (i / 8) * TAU;
        drawArm(ctx, cx, cy, a, coreR, R, lens, time, inward, state.reducedMotion);
      }

      // 中央Core
      const breath = state.reducedMotion ? 0 : Math.sin(time * 0.9) * 0.06;
      const cr = coreR * (1 + breath);
      const g = ctx.createRadialGradient(cx, cy - cr * 0.3, cr * 0.2, cx, cy, cr);
      g.addColorStop(0, accent);
      g.addColorStop(0.5, shade(accent, 0.55));
      g.addColorStop(1, "rgba(6,10,22,0.95)");
      ctx.beginPath();
      ctx.arc(cx, cy, cr, 0, TAU);
      ctx.fillStyle = g;
      ctx.shadowBlur = active && !state.reducedMotion ? 26 : 10;
      ctx.shadowColor = accent;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "rgba(244,247,255,0.5)";
      ctx.stroke();

      raf = requestAnimationFrame(draw);
    };

    const onVisibility = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!running) {
        running = true;
        last = 0;
        raf = requestAnimationFrame(draw);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    raf = requestAnimationFrame(draw);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <div ref={wrapRef} className="absolute inset-0" aria-hidden>
      <canvas ref={canvasRef} />
    </div>
  );
}

function drawArm(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  angle: number,
  r0: number,
  r1: number,
  lens: CoreLens,
  time: number,
  inward: boolean,
  reduced: boolean,
) {
  const failed =
    lens.status === "timeout" || lens.status === "parse_error" || lens.status === "error";
  const dim = lens.status === "inactive";
  const working = lens.status === "working" || lens.status === "queued";
  const done = lens.status === "done";

  const perp = angle + Math.PI / 2;
  const seg = 16;
  const pts: { x: number; y: number; t: number }[] = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const rr = r0 + (r1 - r0) * t;
    const wave = reduced ? 0 : Math.sin(time * 1.6 + t * 3 + lens.hue) * 8 * t;
    const x = cx + Math.cos(angle) * rr + Math.cos(perp) * wave;
    const y = cy + Math.sin(angle) * rr + Math.sin(perp) * wave;
    pts.push({ x, y, t });
  }

  // ベースの腕
  let base = dim
    ? "rgba(120,140,175,0.14)"
    : failed
      ? "rgba(120,130,150,0.25)"
      : `hsla(${lens.hue}, 70%, 62%, 0.5)`;
  if (lens.emphasis === "tension") base = "rgba(232,121,249,0.55)";
  if (lens.emphasis === "resonance") base = "rgba(103,232,249,0.6)";

  for (let i = 0; i < pts.length - 1; i++) {
    const p1 = pts[i];
    const p2 = pts[i + 1];
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineWidth = (1 - p1.t) * 5 + 1.2;
    ctx.lineCap = "round";
    ctx.strokeStyle = base;
    ctx.stroke();
  }

  // 進行光(working): 腕に沿って移動する明点。synth/verify では内向き。
  if (working && !reduced) {
    let prog = (time * 0.55 + lens.hue * 0.1) % 1;
    if (inward) prog = 1 - prog;
    const idx = Math.min(pts.length - 1, Math.floor(prog * (pts.length - 1)));
    const p = pts[idx];
    const c =
      lens.emphasis === "tension"
        ? "#e879f9"
        : lens.emphasis === "resonance"
          ? "#67e8f9"
          : "#a5f3fc";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.4, 0, TAU);
    ctx.fillStyle = c;
    ctx.shadowBlur = 12;
    ctx.shadowColor = c;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // 腕先(レンズ位置)
  const tip = pts[pts.length - 1];
  ctx.beginPath();
  ctx.arc(tip.x, tip.y, done ? 5 : 4, 0, TAU);
  if (done) {
    const c = `hsl(${lens.hue}, 80%, 68%)`;
    ctx.fillStyle = c;
    ctx.shadowBlur = reduced ? 0 : 14;
    ctx.shadowColor = c;
  } else if (lens.emphasis !== "none") {
    const c = lens.emphasis === "tension" ? "#e879f9" : "#67e8f9";
    ctx.fillStyle = c;
    ctx.shadowBlur = reduced ? 0 : 16;
    ctx.shadowColor = c;
  } else {
    ctx.fillStyle = dim ? "rgba(120,140,175,0.35)" : "#0f172a";
    ctx.shadowBlur = 0;
  }
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = failed
    ? "rgba(251,113,133,0.6)"
    : done
      ? "rgba(244,247,255,0.85)"
      : "rgba(120,150,190,0.5)";
  ctx.stroke();
}

// 色を暗くする簡易関数。
function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * f);
  const g = Math.round(((n >> 8) & 255) * f);
  const b = Math.round((n & 255) * f);
  return `rgb(${r},${g},${b})`;
}

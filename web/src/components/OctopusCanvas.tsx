import { memo, useEffect, useRef } from "react";
import type { AppState } from "../types";

// --- 立体的なサイバーオクトパスアニメーション ---
// docs/reference/prototype.jsx からの移植。既存の appState 描画ロジックは変更しない (絶対ルール4)。
// P2拡張: 深化中に「対角の2本の腕だけが光る」演出のため、追加の任意 prop deepenArms を導入。
// deepenArms が null のとき挙動は移植元と完全に同一(既存コードパスをそのまま通す)。
interface OctopusCanvasProps {
  appState: AppState;
  deepenArms?: number[] | null;
  resonanceArms?: number[] | null;
}

const OctopusCanvas = memo(
  ({ appState, deepenArms = null, resonanceArms = null }: OctopusCanvasProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const appStateRef = useRef<AppState>(appState);
  const deepenArmsRef = useRef<number[] | null>(deepenArms);
  const resonanceArmsRef = useRef<number[] | null>(resonanceArms);

  useEffect(() => {
    appStateRef.current = appState;
  }, [appState]);

  useEffect(() => {
    deepenArmsRef.current = deepenArms;
  }, [deepenArms]);

  useEffect(() => {
    resonanceArmsRef.current = resonanceArms;
  }, [resonanceArms]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let animationFrameId: number;

    const handleResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    handleResize();
    window.addEventListener("resize", handleResize);

    const draw = () => {
      const state = appStateRef.current;
      // 深化中に光らせる対角2腕(null のときは通常描画)
      const deepen = deepenArmsRef.current;
      // 共鳴中に呼応させる2腕(null のときは通常描画)
      const resonance = resonanceArmsRef.current;
      const width = canvas.width;
      const height = canvas.height;
      const time = Date.now() / 1000;

      ctx.fillStyle = "rgba(2, 6, 23, 0.4)";
      ctx.fillRect(0, 0, width, height);

      const cx = width / 2;
      const cy = height * 0.35;

      const renderQueue: Array<{
        type: "tentacle" | "head";
        id?: number;
        baseAngle?: number;
        depth: number;
      }> = [];
      const numTentacles = 8;

      for (let i = 0; i < numTentacles; i++) {
        const baseAngle =
          (i / numTentacles) * Math.PI * 2 + Math.sin(time * 0.1) * 0.5;
        const depth = Math.sin(baseAngle) * 350;
        renderQueue.push({ type: "tentacle", id: i, baseAngle, depth });
      }

      renderQueue.push({ type: "head", depth: 0 });
      renderQueue.sort((a, b) => b.depth - a.depth);

      const drawHead = () => {
        const hY = cy + Math.sin(time) * 15;

        ctx.beginPath();
        ctx.ellipse(cx, hY, 70, 95, 0, 0, Math.PI * 2);

        const grad = ctx.createRadialGradient(cx, hY - 30, 10, cx, hY, 100);
        if (state === "processing_main") {
          grad.addColorStop(0, "#d8b4fe");
          grad.addColorStop(0.4, "#9333ea");
          grad.addColorStop(1, "#3b0764");
          ctx.shadowBlur = 60;
          ctx.shadowColor = "#b026ff";
        } else {
          grad.addColorStop(0, "#38bdf8");
          grad.addColorStop(0.4, "#0ea5e9");
          grad.addColorStop(1, "#082f49");
          ctx.shadowBlur = 20;
          ctx.shadowColor = "#0284c7";
        }

        ctx.fillStyle = grad;
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = state === "processing_main" ? "#e9d5ff" : "#bae6fd";
        ctx.stroke();
        ctx.shadowBlur = 0;
      };

      const drawTentacle = (tData: { id: number; baseAngle: number }) => {
        const segments = 45;
        const maxLength = 350;
        const fov = 500;
        const zOffset = 300;

        const points: Array<{
          x: number;
          y: number;
          scale: number;
          progress: number;
          y3d: number;
        }> = [];

        for (let i = 0; i <= segments; i++) {
          const progress = i / segments;
          const r = progress * maxLength;

          const waveX =
            Math.cos(time * 2.0 + progress * 6 + tData.id) * 40 * progress;
          const waveZ =
            Math.sin(time * 1.5 + progress * 8 + tData.id) * 60 * progress;

          const x3d =
            Math.cos(tData.baseAngle) * r +
            Math.cos(tData.baseAngle + Math.PI / 2) * waveX;
          const y3d =
            Math.sin(tData.baseAngle) * r +
            Math.sin(tData.baseAngle + Math.PI / 2) * waveX;
          const z3d = waveZ + Math.sin(time * 0.8 + tData.id) * 30 * progress;

          const scale = fov / (fov + y3d + zOffset);
          const x2d = cx + x3d * scale;
          const y2d = cy + Math.sin(time) * 15 + z3d * scale - y3d * scale * 0.3;

          points.push({ x: x2d, y: y2d, scale, progress, y3d });
        }

        for (let i = 0; i < points.length - 1; i++) {
          const p1 = points[i];
          const p2 = points[i + 1];
          const depthFactor = Math.max(0.1, p1.scale);
          const thickness = (1 - p1.progress) * 30 * depthFactor + 2;

          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.lineWidth = thickness;
          ctx.lineCap = "round";

          let strokeColor = `rgba(${30 * depthFactor}, ${50 * depthFactor}, ${80 * depthFactor}, 0.9)`;

          if (resonance) {
            // 共鳴中: 選ばれた2腕が「呼応」する。位相を揃えつつ光が2本の間を往復
            // (交互に強まる)。色はシアン〜白系(深化の紫と差別化)。
            const ri = resonance.indexOf(tData.id);
            if (ri !== -1) {
              const phase = ri === 1 ? Math.PI : 0; // 2本を逆位相にして往復に見せる
              const back = 0.5 + 0.5 * Math.sin(time * 3 + phase); // 0..1 交互
              // 波は同期(tData.id を使わず共通位相)して「呼応」に見せる
              const sync = Math.sin(p1.progress * 16 - time * 5);
              if (sync > 0.2) {
                const r = Math.round(150 + 105 * back);
                strokeColor = `rgba(${r}, 240, 255, ${(0.45 + 0.55 * back) * depthFactor})`;
                ctx.shadowBlur = (12 + 22 * back) * depthFactor;
                ctx.shadowColor = "#a5f3fc";
              } else {
                strokeColor = `rgba(90, 180, 210, ${0.5 * depthFactor})`;
                ctx.shadowBlur = 0;
              }
            } else {
              strokeColor = `rgba(${18 * depthFactor}, ${28 * depthFactor}, ${40 * depthFactor}, 0.5)`;
              ctx.shadowBlur = 0;
            }
          } else if (deepen) {
            // 深化中: 対角2腕だけが強く脈打ち、他は暗転する
            if (deepen.includes(tData.id)) {
              const pulse = Math.sin(p1.progress * 22 + time * 16);
              if (pulse > 0.4) {
                strokeColor = `rgba(232, 121, 249, ${Math.min(1, pulse + 0.3) * depthFactor})`;
                ctx.shadowBlur = 22 * depthFactor;
                ctx.shadowColor = "#e879f9";
              } else {
                strokeColor = `rgba(120, 40, 160, ${0.6 * depthFactor})`;
                ctx.shadowBlur = 0;
              }
            } else {
              strokeColor = `rgba(${18 * depthFactor}, ${22 * depthFactor}, ${38 * depthFactor}, 0.5)`;
              ctx.shadowBlur = 0;
            }
          } else if (state === "processing_subs") {
            const pulse = Math.sin(p1.progress * 25 - time * 12);
            if (pulse > 0.7) {
              strokeColor = `rgba(0, 243, 255, ${pulse * depthFactor})`;
              ctx.shadowBlur = 10 * depthFactor;
              ctx.shadowColor = "#00f3ff";
            } else {
              ctx.shadowBlur = 0;
            }
          } else if (state === "processing_main") {
            const pulse = Math.sin(p1.progress * 25 + time * 15);
            if (pulse > 0.7) {
              strokeColor = `rgba(176, 38, 255, ${pulse * depthFactor})`;
              ctx.shadowBlur = 15 * depthFactor;
              ctx.shadowColor = "#b026ff";
            } else {
              ctx.shadowBlur = 0;
            }
          } else {
            ctx.shadowBlur = 0;
          }

          ctx.strokeStyle = strokeColor;
          ctx.stroke();

          if (i % 4 === 0 && i > 5) {
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const angle = Math.atan2(dy, dx);
            const suckerDist = thickness * 0.55;

            const sx = p1.x + Math.cos(angle + Math.PI / 2) * suckerDist;
            const sy = p1.y + Math.sin(angle + Math.PI / 2) * suckerDist;

            ctx.beginPath();
            ctx.ellipse(
              sx,
              sy,
              thickness * 0.3,
              thickness * 0.15,
              angle,
              0,
              Math.PI * 2,
            );
            ctx.fillStyle = `rgba(15, 23, 42, 0.9)`;
            ctx.fill();
            ctx.strokeStyle = `rgba(125, 211, 252, 0.4)`;
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }

        const endP = points[points.length - 1];
        ctx.beginPath();
        const subRadius = 15 * endP.scale;
        ctx.arc(endP.x, endP.y, subRadius, 0, Math.PI * 2);

        const deepHi = deepen ? deepen.includes(tData.id) : false;
        const resoHi = resonance ? resonance.includes(tData.id) : false;
        if (resonance) {
          // 共鳴中: 呼応する2腕の吸盤先端だけ点灯(シアン〜白)、他は消灯
          if (resoHi) {
            ctx.fillStyle = "#67e8f9";
            ctx.shadowBlur = 28 * endP.scale;
            ctx.shadowColor = "#a5f3fc";
          } else {
            ctx.fillStyle = "#0f172a";
            ctx.shadowBlur = 0;
          }
        } else if (deepen) {
          // 深化中: 光る2腕の吸盤先端だけ点灯、他は消灯
          if (deepHi) {
            ctx.fillStyle = "#e879f9";
            ctx.shadowBlur = 28 * endP.scale;
            ctx.shadowColor = "#e879f9";
          } else {
            ctx.fillStyle = "#0f172a";
            ctx.shadowBlur = 0;
          }
        } else if (state === "processing_subs") {
          ctx.fillStyle = "#00f3ff";
          ctx.shadowBlur = 25 * endP.scale;
          ctx.shadowColor = "#00f3ff";
        } else {
          ctx.fillStyle = "#0f172a";
          ctx.shadowBlur = 0;
        }
        ctx.fill();
        ctx.strokeStyle = resonance
          ? resoHi
            ? "#ecfeff"
            : "#334155"
          : deepen
            ? deepHi
              ? "#fdf4ff"
              : "#334155"
            : state === "processing_subs"
              ? "#ffffff"
              : "#38bdf8";
        ctx.lineWidth = 2 * endP.scale;
        ctx.stroke();
        ctx.shadowBlur = 0;
      };

      renderQueue.forEach((item) => {
        if (item.type === "head") drawHead();
        else if (item.id !== undefined && item.baseAngle !== undefined) {
          drawTentacle({ id: item.id, baseAngle: item.baseAngle });
        }
      });

      animationFrameId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <canvas ref={canvasRef} className="fixed inset-0 z-0 pointer-events-none" />
  );
});

OctopusCanvas.displayName = "OctopusCanvas";

export default OctopusCanvas;

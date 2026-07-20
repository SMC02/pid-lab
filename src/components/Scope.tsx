/**
 * Scope — a dependency-free canvas oscilloscope. Draws the setpoint
 * (amber) and process variable (green) on a dark instrument screen,
 * plus a smaller controller-output trace underneath.
 */
import { useEffect, useRef } from "react";
import type { SimSample } from "../engine/simulate.ts";

interface Props {
  samples: SimSample[];
  window: number; // seconds of history to show
  yMin: number;
  yMax: number;
  uMin: number;
  uMax: number;
  unit: string;
}

export function Scope({ samples, window: win, yMin, yMax, uMin, uMax, unit }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window0();
    const w = (canvas.width = canvas.clientWidth * dpr);
    const h = (canvas.height = canvas.clientHeight * dpr);

    // Layout: main PV pane on top, output pane below.
    const padL = 52 * dpr;
    const padR = 12 * dpr;
    const padT = 10 * dpr;
    const gap = 26 * dpr;
    const uPaneH = h * 0.24;
    const pvPaneH = h - uPaneH - gap - padT - 8 * dpr;

    ctx.fillStyle = "#10161a"; // instrument screen
    ctx.fillRect(0, 0, w, h);

    const tEnd = samples.length ? samples[samples.length - 1]!.t : 0;
    const tStart = Math.max(0, tEnd - win);
    const x = (t: number) => padL + ((t - tStart) / win) * (w - padL - padR);

    const drawPane = (
      top: number,
      height: number,
      lo: number,
      hi: number,
      label: string,
      traces: { key: "pv" | "setpoint" | "u"; color: string; width: number }[],
    ) => {
      const y = (v: number) => top + height - ((v - lo) / (hi - lo || 1)) * height;

      // grid + axis labels
      ctx.strokeStyle = "rgba(120, 150, 160, 0.18)";
      ctx.lineWidth = dpr;
      ctx.fillStyle = "#6d8a94";
      ctx.font = `${10 * dpr}px ui-monospace, monospace`;
      for (let i = 0; i <= 4; i++) {
        const v = lo + ((hi - lo) * i) / 4;
        ctx.beginPath();
        ctx.moveTo(padL, y(v));
        ctx.lineTo(w - padR, y(v));
        ctx.stroke();
        ctx.fillText(v.toFixed(1), 6 * dpr, y(v) + 3 * dpr);
      }
      ctx.fillText(label, padL, top - 6 * dpr);

      // traces
      const visible = samples.filter((s) => s.t >= tStart);
      for (const trace of traces) {
        ctx.strokeStyle = trace.color;
        ctx.lineWidth = trace.width * dpr;
        ctx.beginPath();
        visible.forEach((s, i) => {
          const clamped = Math.min(hi, Math.max(lo, s[trace.key]));
          if (i === 0) ctx.moveTo(x(s.t), y(clamped));
          else ctx.lineTo(x(s.t), y(clamped));
        });
        ctx.stroke();
      }
    };

    drawPane(padT + 12 * dpr, pvPaneH, yMin, yMax, `PROCESS VARIABLE (${unit})`, [
      { key: "setpoint", color: "#e8a33d", width: 1.5 },
      { key: "pv", color: "#57d98a", width: 2 },
    ]);
    drawPane(padT + pvPaneH + gap + 12 * dpr, uPaneH, uMin, uMax, "CONTROLLER OUTPUT", [
      { key: "u", color: "#5db8d6", width: 1.5 },
    ]);

    // time axis
    ctx.fillStyle = "#6d8a94";
    for (let i = 0; i <= 5; i++) {
      const t = tStart + (win * i) / 5;
      ctx.fillText(`${t.toFixed(0)}s`, x(t) - 8 * dpr, h - 4 * dpr);
    }
  }, [samples, win, yMin, yMax, uMin, uMax, unit]);

  return <canvas ref={canvasRef} className="scope" />;
}

/** window.devicePixelRatio without shadowing the `window` prop name. */
function window0(): number {
  return globalThis.devicePixelRatio || 1;
}

/**
 * Step-response performance metrics — the numbers a controls engineer
 * actually reads off a scope: rise time, overshoot, settling time,
 * steady-state error, and IAE as a single quality score.
 *
 * All metrics assume the samples describe the response to a single step
 * from the initial PV to a constant setpoint.
 */
import type { SimSample } from "./simulate.ts";

export interface StepMetrics {
  /** 10% → 90% rise time in seconds, or null if never reached. */
  riseTime: number | null;
  /** Peak overshoot as a % of the step size, 0 if none. */
  overshoot: number;
  /** Time to enter and stay within ±2% of the setpoint, or null. */
  settlingTime: number | null;
  /** |setpoint − mean(pv over final 10% of the run)|. */
  steadyStateError: number;
  /** Integral of absolute error — lower is better overall. */
  iae: number;
}

export function stepMetrics(samples: SimSample[]): StepMetrics {
  if (samples.length < 3) {
    return { riseTime: null, overshoot: 0, settlingTime: null, steadyStateError: 0, iae: 0 };
  }
  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  const sp = last.setpoint;
  const start = first.pv;
  const stepSize = sp - start;
  const dt = (samples[1]!.t - first.t) || 1e-9;

  // -- IAE --
  let iae = 0;
  for (const s of samples) iae += Math.abs(s.setpoint - s.pv) * dt;

  // Degenerate step: nothing meaningful to measure.
  if (Math.abs(stepSize) < 1e-9) {
    return { riseTime: null, overshoot: 0, settlingTime: null, steadyStateError: 0, iae };
  }

  // Progress along the step, 0 at start, 1 at setpoint (sign-normalized).
  const progress = (pv: number) => (pv - start) / stepSize;

  // -- rise time: first crossing of 10% to first crossing of 90% --
  let t10: number | null = null;
  let t90: number | null = null;
  for (const s of samples) {
    const p = progress(s.pv);
    if (t10 === null && p >= 0.1) t10 = s.t;
    if (t90 === null && p >= 0.9) t90 = s.t;
    if (t10 !== null && t90 !== null) break;
  }
  const riseTime = t10 !== null && t90 !== null ? t90 - t10 : null;

  // -- overshoot --
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, progress(s.pv));
  const overshoot = Math.max(0, (peak - 1) * 100);

  // -- settling time: last exit from the ±2% band --
  const band = 0.02 * Math.abs(stepSize);
  let settlingTime: number | null = null;
  for (let i = samples.length - 1; i >= 0; i--) {
    if (Math.abs(samples[i]!.pv - sp) > band) {
      settlingTime = i + 1 < samples.length ? samples[i + 1]!.t : null;
      break;
    }
    if (i === 0) settlingTime = first.t; // never left the band
  }

  // -- steady-state error over the final 10% of the run --
  const tailStart = Math.floor(samples.length * 0.9);
  let sum = 0;
  for (let i = tailStart; i < samples.length; i++) sum += samples[i]!.pv;
  const steadyStateError = Math.abs(sp - sum / (samples.length - tailStart));

  return { riseTime, overshoot, settlingTime, steadyStateError, iae };
}

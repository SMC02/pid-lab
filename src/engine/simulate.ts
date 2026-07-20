/**
 * Closed-loop simulation: RK4 integration of the plant between controller
 * samples (zero-order hold on u — exactly how a real digital controller
 * drives a continuous plant).
 */
import type { Pid } from "./pid.ts";
import type { Plant } from "./plants.ts";

/** One RK4 step of dx/dt = f(x, u, d) with u, d held constant. */
export function rk4Step(
  f: (state: number[], u: number, d: number) => number[],
  state: number[],
  u: number,
  d: number,
  h: number,
): number[] {
  const add = (a: number[], b: number[], scale: number) =>
    a.map((ai, i) => ai + scale * (b[i] ?? 0));

  const k1 = f(state, u, d);
  const k2 = f(add(state, k1, h / 2), u, d);
  const k3 = f(add(state, k2, h / 2), u, d);
  const k4 = f(add(state, k3, h), u, d);
  return state.map(
    (xi, i) =>
      xi + (h / 6) * ((k1[i] ?? 0) + 2 * (k2[i] ?? 0) + 2 * (k3[i] ?? 0) + (k4[i] ?? 0)),
  );
}

export interface SimSample {
  t: number;
  setpoint: number;
  pv: number;
  u: number;
}

export interface SimOptions {
  duration: number; // s
  dt: number; // controller sample time, s
  /** Setpoint as a function of time (step schedules, etc.). */
  setpoint: (t: number) => number;
  /** Load disturbance as a function of time. Defaults to 0. */
  disturbance?: (t: number) => number;
}

/** Run a whole closed-loop simulation and return the sampled response. */
export function simulate(plant: Plant, pid: Pid, options: SimOptions): SimSample[] {
  const { duration, dt, setpoint, disturbance = () => 0 } = options;
  let state = [...plant.initialState];
  const samples: SimSample[] = [];

  const steps = Math.round(duration / dt);
  for (let i = 0; i <= steps; i++) {
    const t = i * dt;
    const sp = setpoint(t);
    const pv = state[0] ?? 0;
    const u = pid.step(sp, pv);
    samples.push({ t, setpoint: sp, pv, u });
    // Integrate plant to the next controller sample (2 RK4 substeps for accuracy).
    const h = dt / 2;
    const d = disturbance(t);
    state = rk4Step(plant.derivatives, state, u, d, h);
    state = rk4Step(plant.derivatives, state, u, d, h);
  }
  return samples;
}

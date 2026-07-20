/**
 * Plant models — the physical systems being controlled, expressed as
 * ordinary differential equations: dx/dt = f(x, u).
 *
 * Three plants with genuinely different control personalities:
 *
 * 1. **Thermal (first-order)** — a heater block. Self-regulating: for any
 *    constant input it settles somewhere. Easy to control, P-only leaves
 *    steady-state error.
 * 2. **Mass-spring-damper (second-order)** — position control with
 *    inertia. Oscillates; too much Kp rings, Kd damps it.
 * 3. **Motor position (integrating)** — an integrator in the loop. The
 *    plant itself accumulates, so even P-only reaches zero steady-state
 *    error, but it's easy to make unstable.
 */

export interface Plant {
  id: string;
  name: string;
  description: string;
  /** State vector; index 0 is always the measured process variable. */
  initialState: number[];
  /** dx/dt = f(state, u, disturbance) */
  derivatives: (state: number[], u: number, disturbance: number) => number[];
  /** Actuator limits fed to the PID. */
  outMin: number;
  outMax: number;
  /** Sensible setpoint range for the UI. */
  spMin: number;
  spMax: number;
  defaultSetpoint: number;
  unit: string;
  /** Gains that behave reasonably, as a starting preset. */
  suggestedGains: { kp: number; ki: number; kd: number };
}

export const PLANTS: readonly Plant[] = [
  {
    id: "thermal",
    name: "Heater block (1st order)",
    description:
      "Thermal mass with a heater. Self-regulating: P-only control always leaves a steady-state error — add Ki to remove it.",
    initialState: [25], // °C, ambient
    derivatives: ([T = 25], u, d) => {
      const ambient = 25;
      const tau = 8; // s
      const gain = 0.9; // °C per %power at steady state
      return [(-(T - ambient) + gain * u + d) / tau];
    },
    outMin: 0,
    outMax: 100,
    spMin: 25,
    spMax: 110,
    defaultSetpoint: 80,
    unit: "°C",
    suggestedGains: { kp: 4, ki: 0.8, kd: 0 },
  },
  {
    id: "msd",
    name: "Mass-spring-damper (2nd order)",
    description:
      "Position control of a mass on a spring. Inertia means overshoot: raise Kp and watch it ring, then add Kd to damp it.",
    initialState: [0, 0], // position m, velocity m/s
    derivatives: ([x = 0, v = 0], u, d) => {
      const m = 1.0; // kg
      const c = 1.2; // N·s/m
      const k = 4.0; // N/m
      return [v, (u + d - c * v - k * x) / m];
    },
    outMin: -50,
    outMax: 50,
    spMin: -5,
    spMax: 5,
    defaultSetpoint: 2,
    unit: "m",
    suggestedGains: { kp: 25, ki: 8, kd: 8 },
  },
  {
    id: "motor",
    name: "Motor position (integrating)",
    description:
      "Angle of a motor shaft — an integrator in the loop. P-only reaches zero steady-state error here, but it's easy to destabilize.",
    initialState: [0, 0], // angle rad, angular velocity rad/s
    derivatives: ([, w = 0], u, d) => {
      const J = 0.05; // kg·m²
      const b = 0.4; // N·m·s friction
      return [w, (u + d - b * w) / J];
    },
    outMin: -10,
    outMax: 10,
    spMin: -Math.PI,
    spMax: Math.PI,
    defaultSetpoint: 1.5,
    unit: "rad",
    suggestedGains: { kp: 12, ki: 0, kd: 1.5 },
  },
] as const;

export function plantById(id: string): Plant {
  const plant = PLANTS.find((p) => p.id === id);
  if (!plant) throw new Error(`unknown plant '${id}'`);
  return plant;
}

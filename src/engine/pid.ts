/**
 * A discrete PID controller with the details that matter on real hardware:
 *
 * - **Output saturation** — actuators have limits; the controller clamps.
 * - **Anti-windup (conditional integration)** — while the output is
 *   saturated, the integrator only accumulates error that would drive the
 *   output *away* from the limit. Without this, the integral "winds up"
 *   during saturation and causes huge overshoot when the error flips sign.
 * - **Derivative on measurement** — differentiating the *error* causes an
 *   output spike ("derivative kick") every time the setpoint steps.
 *   Differentiating the measurement instead gives the same damping without
 *   the kick. (Toggleable, so the simulator can demonstrate the difference.)
 */

export interface PidGains {
  kp: number;
  ki: number;
  kd: number;
}

export interface PidConfig extends PidGains {
  /** Controller sample time in seconds. */
  dt: number;
  outMin: number;
  outMax: number;
  /** true = derivative on measurement (default); false = on error. */
  derivativeOnMeasurement?: boolean;
  /** true = conditional-integration anti-windup (default). */
  antiWindup?: boolean;
}

export interface PidState {
  integral: number;
  prevError: number;
  prevMeasurement: number;
  /** Last computed output, after clamping. */
  output: number;
  saturated: boolean;
}

export function createPid(config: PidConfig) {
  const cfg: Required<PidConfig> = {
    derivativeOnMeasurement: true,
    antiWindup: true,
    ...config,
  };

  const state: PidState = {
    integral: 0,
    prevError: 0,
    prevMeasurement: NaN,
    output: 0,
    saturated: false,
  };

  function step(setpoint: number, measurement: number): number {
    const error = setpoint - measurement;

    // -- proportional --
    const p = cfg.kp * error;

    // -- integral with conditional anti-windup --
    // Only integrate if not saturated, or if this error would pull the
    // output back off the limit.
    const wouldUnwind =
      (state.output >= cfg.outMax && error < 0) ||
      (state.output <= cfg.outMin && error > 0);
    if (!cfg.antiWindup || !state.saturated || wouldUnwind) {
      state.integral += cfg.ki * error * cfg.dt;
    }

    // -- derivative --
    let d = 0;
    if (cfg.kd !== 0) {
      if (cfg.derivativeOnMeasurement) {
        // Negative sign: d(error)/dt = -d(measurement)/dt when SP constant.
        const dm = Number.isNaN(state.prevMeasurement)
          ? 0
          : (measurement - state.prevMeasurement) / cfg.dt;
        d = -cfg.kd * dm;
      } else {
        d = (cfg.kd * (error - state.prevError)) / cfg.dt;
      }
    }

    const raw = p + state.integral + d;
    const clamped = Math.min(cfg.outMax, Math.max(cfg.outMin, raw));

    state.saturated = raw !== clamped;
    state.prevError = error;
    state.prevMeasurement = measurement;
    state.output = clamped;
    return clamped;
  }

  function reset(): void {
    state.integral = 0;
    state.prevError = 0;
    state.prevMeasurement = NaN;
    state.output = 0;
    state.saturated = false;
  }

  return { step, reset, state, config: cfg };
}

export type Pid = ReturnType<typeof createPid>;

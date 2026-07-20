/**
 * Engine tests. These verify actual control theory numerically:
 * the integrator's accuracy against a closed-form solution, classic
 * P/PI behavior, anti-windup, derivative kick, and metric math.
 *
 *     node --test tests/
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stepMetrics } from "../src/engine/metrics.ts";
import { createPid } from "../src/engine/pid.ts";
import { plantById } from "../src/engine/plants.ts";
import { rk4Step, simulate } from "../src/engine/simulate.ts";

const DT = 0.02;

function pidFor(
  plantId: string,
  gains: { kp: number; ki: number; kd: number },
  overrides: Partial<Parameters<typeof createPid>[0]> = {},
) {
  const plant = plantById(plantId);
  return createPid({
    ...gains,
    dt: DT,
    outMin: plant.outMin,
    outMax: plant.outMax,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
describe("RK4 integrator", () => {
  it("matches the analytic solution of a first-order system to <0.1%", () => {
    // dx/dt = -x/tau, x(0)=1  ->  x(t) = exp(-t/tau)
    const tau = 2;
    const f = ([x = 0]: number[]) => [-x / tau];
    let state = [1];
    const h = 0.05;
    for (let i = 0; i < 40; i++) state = rk4Step(f, state, 0, 0, h); // t = 2 = tau
    const analytic = Math.exp(-1);
    assert.ok(Math.abs((state[0]! - analytic) / analytic) < 0.001);
  });
});

// ---------------------------------------------------------------------------
describe("classic control behavior (thermal plant)", () => {
  it("P-only control leaves steady-state error; PI removes it", () => {
    const run = (ki: number) =>
      simulate(plantById("thermal"), pidFor("thermal", { kp: 4, ki, kd: 0 }), {
        duration: 120,
        dt: DT,
        setpoint: () => 80,
      });

    const pOnly = stepMetrics(run(0));
    const pi = stepMetrics(run(0.8));

    assert.ok(pOnly.steadyStateError > 2, `P-only SSE was ${pOnly.steadyStateError}`);
    assert.ok(pi.steadyStateError < 0.2, `PI SSE was ${pi.steadyStateError}`);
  });

  it("anti-windup reduces overshoot and IAE under saturation", () => {
    const run = (antiWindup: boolean) =>
      simulate(
        plantById("thermal"),
        pidFor("thermal", { kp: 2, ki: 2.5, kd: 0 }, { antiWindup }),
        { duration: 120, dt: DT, setpoint: () => 105 }, // near actuator limit -> saturates
      );

    const withAw = stepMetrics(run(true));
    const withoutAw = stepMetrics(run(false));

    assert.ok(
      withAw.overshoot < withoutAw.overshoot,
      `overshoot with AW ${withAw.overshoot} !< without ${withoutAw.overshoot}`,
    );
    assert.ok(withAw.iae < withoutAw.iae);
  });
});

// ---------------------------------------------------------------------------
describe("derivative kick", () => {
  it("derivative-on-error spikes at a setpoint step; on-measurement does not", () => {
    const kick = (derivativeOnMeasurement: boolean) => {
      const pid = createPid({
        kp: 1,
        ki: 0,
        kd: 2,
        dt: DT,
        outMin: -1e6,
        outMax: 1e6,
        derivativeOnMeasurement,
      });
      pid.step(0, 0); // settle at sp=0
      return Math.abs(pid.step(10, 0)); // setpoint steps 0 -> 10
    };

    const onError = kick(false);
    const onMeasurement = kick(true);
    assert.ok(onError > 500, `on-error kick was only ${onError}`); // kd*Δsp/dt = 1000
    assert.ok(onMeasurement < 50, `on-measurement kick was ${onMeasurement}`);
  });
});

// ---------------------------------------------------------------------------
describe("second-order plant (mass-spring-damper)", () => {
  it("higher Kp increases overshoot; adding Kd damps it", () => {
    const run = (kp: number, kd: number) =>
      stepMetrics(
        simulate(plantById("msd"), pidFor("msd", { kp, ki: 0, kd }), {
          duration: 30,
          dt: DT,
          setpoint: () => 2,
        }),
      );

    const gentle = run(15, 0);
    const aggressive = run(60, 0);
    const damped = run(60, 10);

    assert.ok(aggressive.overshoot > gentle.overshoot + 5);
    assert.ok(damped.overshoot < aggressive.overshoot - 5);
  });
});

// ---------------------------------------------------------------------------
describe("integrating plant (motor position)", () => {
  it("P-only reaches zero steady-state error (the plant integrates for you)", () => {
    const m = stepMetrics(
      simulate(plantById("motor"), pidFor("motor", { kp: 12, ki: 0, kd: 1.5 }), {
        duration: 20,
        dt: DT,
        setpoint: () => 1.5,
      }),
    );
    assert.ok(m.steadyStateError < 0.02, `SSE was ${m.steadyStateError}`);
  });
});

// ---------------------------------------------------------------------------
describe("disturbance rejection", () => {
  it("PI control recovers from a load disturbance; P-only does not fully", () => {
    const run = (ki: number) =>
      simulate(plantById("thermal"), pidFor("thermal", { kp: 4, ki, kd: 0 }), {
        duration: 240,
        dt: DT,
        setpoint: () => 60,
        disturbance: (t) => (t > 120 ? -15 : 0), // cold draft halfway through
      });

    const tail = (samples: ReturnType<typeof run>) => {
      const n = samples.length;
      let sum = 0;
      for (let i = Math.floor(n * 0.95); i < n; i++) sum += samples[i]!.pv;
      return Math.abs(60 - sum / (n - Math.floor(n * 0.95)));
    };

    assert.ok(tail(run(0.8)) < 0.3, "PI should recover to setpoint");
    assert.ok(tail(run(0)) > 1.5, "P-only should sag under load");
  });
});

// ---------------------------------------------------------------------------
describe("metrics math", () => {
  it("first-order response: no overshoot, rise time ~ 2.2*tau", () => {
    // Synthetic exact first-order step response, tau = 2.
    const tau = 2;
    const samples = Array.from({ length: 1001 }, (_, i) => {
      const t = i * 0.02;
      return { t, setpoint: 1, pv: 1 - Math.exp(-t / tau), u: 0 };
    });
    const m = stepMetrics(samples);
    assert.equal(m.overshoot, 0);
    assert.ok(m.riseTime !== null);
    assert.ok(Math.abs(m.riseTime! - 2.197 * tau) < 0.1, `riseTime ${m.riseTime}`);
  });

  it("handles degenerate inputs without dividing by zero", () => {
    const flat = Array.from({ length: 100 }, (_, i) => ({
      t: i * 0.02,
      setpoint: 50,
      pv: 50,
      u: 0,
    }));
    const m = stepMetrics(flat);
    assert.equal(m.overshoot, 0);
    assert.equal(m.steadyStateError, 0);
    const empty = stepMetrics([]);
    assert.equal(empty.riseTime, null);
  });
});

/**
 * PID Lab — interactive PID tuning against simulated plants.
 *
 * The simulation advances in real time inside requestAnimationFrame:
 * fixed 20 ms controller steps, RK4 plant integration between them,
 * so the physics is identical to the tested engine — the UI is just
 * a window onto it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { stepMetrics } from "./engine/metrics.ts";
import { createPid, type Pid } from "./engine/pid.ts";
import { PLANTS, plantById } from "./engine/plants.ts";
import { rk4Step, type SimSample } from "./engine/simulate.ts";
import { Scope } from "./components/Scope.tsx";

const DT = 0.02; // controller sample time, s
const SCOPE_WINDOW = 30; // s of visible history
const DISTURBANCE_DURATION = 3; // s

interface Gains {
  kp: number;
  ki: number;
  kd: number;
}

export default function App() {
  const [plantId, setPlantId] = useState("thermal");
  const plant = plantById(plantId);

  const [gains, setGains] = useState<Gains>(plant.suggestedGains);
  const [setpoint, setSetpoint] = useState(plant.defaultSetpoint);
  const [running, setRunning] = useState(true);
  const [samples, setSamples] = useState<SimSample[]>([]);

  // Mutable simulation state lives in refs — React state is only the
  // rendered snapshot.
  const simRef = useRef({
    t: 0,
    state: [...plant.initialState] as number[],
    pid: null as Pid | null,
    disturbanceUntil: -1,
    lastSpChange: 0,
    buffer: [] as SimSample[],
  });

  const makePid = useCallback(
    (g: Gains, carryIntegral = 0) => {
      const pid = createPid({
        ...g,
        dt: DT,
        outMin: plant.outMin,
        outMax: plant.outMax,
      });
      pid.state.integral = carryIntegral; // bumpless-ish gain changes
      return pid;
    },
    [plant],
  );

  /** Full reset: new plant state, cleared traces. */
  const reset = useCallback(
    (nextPlantId = plantId, nextGains = gains, nextSp?: number) => {
      const p = plantById(nextPlantId);
      const sim = simRef.current;
      sim.t = 0;
      sim.state = [...p.initialState];
      sim.pid = null; // recreated lazily with current gains
      sim.disturbanceUntil = -1;
      sim.lastSpChange = 0;
      sim.buffer = [];
      setSamples([]);
      setGains(nextGains);
      setSetpoint(nextSp ?? p.defaultSetpoint);
    },
    [plantId, gains],
  );

  const changePlant = (id: string) => {
    setPlantId(id);
    reset(id, plantById(id).suggestedGains, plantById(id).defaultSetpoint);
  };

  const changeGains = (g: Gains) => {
    setGains(g);
    const sim = simRef.current;
    sim.pid = makePid(g, sim.pid?.state.integral ?? 0);
  };

  const changeSetpoint = (sp: number) => {
    setSetpoint(sp);
    simRef.current.lastSpChange = simRef.current.t;
  };

  const injectDisturbance = () => {
    simRef.current.disturbanceUntil = simRef.current.t + DISTURBANCE_DURATION;
  };

  // ------------------------------------------------------------ sim loop
  const setpointRef = useRef(setpoint);
  setpointRef.current = setpoint;

  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let last = performance.now();

    const frame = (now: number) => {
      const sim = simRef.current;
      if (!sim.pid) sim.pid = makePid(gains, 0);

      let elapsed = Math.min((now - last) / 1000, 0.25); // clamp tab-switch jumps
      last = now;

      while (elapsed > 0) {
        const sp = setpointRef.current;
        const pv = sim.state[0] ?? 0;
        const u = sim.pid.step(sp, pv);
        const magnitude = (plant.outMax - plant.outMin) * 0.25;
        const d = sim.t < sim.disturbanceUntil ? -magnitude : 0;
        const h = DT / 2;
        sim.state = rk4Step(plant.derivatives, sim.state, u, d, h);
        sim.state = rk4Step(plant.derivatives, sim.state, u, d, h);
        sim.t += DT;
        sim.buffer.push({ t: sim.t, setpoint: sp, pv, u });
        elapsed -= DT;
      }

      // Trim buffer: keep the scope window plus metric history (capped at
      // 120 s so the buffer can't grow unbounded during long runs).
      const metricHistory = Math.min(120, sim.t - sim.lastSpChange);
      const cutoff = sim.t - Math.max(SCOPE_WINDOW, metricHistory) - 1;
      while (sim.buffer.length && sim.buffer[0]!.t < cutoff) sim.buffer.shift();

      setSamples([...sim.buffer]);
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [running, gains, plant, makePid]);

  // ------------------------------------------------------------- metrics
  const metrics = useMemo(() => {
    const sim = simRef.current;
    const window = samples.filter((s) => s.t >= sim.lastSpChange);
    return stepMetrics(window);
  }, [samples]);

  const fmt = (v: number | null, digits = 2, suffix = "") =>
    v === null || Number.isNaN(v) ? "—" : `${v.toFixed(digits)}${suffix}`;

  // ------------------------------------------------------------------ UI
  const yPad = (plant.spMax - plant.spMin) * 0.25;

  return (
    <div className="app">
      <header>
        <h1>PID LAB</h1>
        <span className="tag">closed-loop tuning playground</span>
      </header>

      <main>
        <section className="scope-panel">
          <Scope
            samples={samples}
            window={SCOPE_WINDOW}
            yMin={plant.spMin - yPad}
            yMax={plant.spMax + yPad}
            uMin={plant.outMin}
            uMax={plant.outMax}
            unit={plant.unit}
          />
          <div className="legend">
            <span className="swatch sp" /> setpoint
            <span className="swatch pv" /> process variable
            <span className="swatch u" /> output
          </div>
        </section>

        <section className="controls">
          <label className="field">
            <span>Plant</span>
            <select value={plantId} onChange={(e) => changePlant(e.target.value)}>
              {PLANTS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <p className="plant-blurb">{plant.description}</p>

          <label className="field">
            <span>
              Setpoint <b>{setpoint.toFixed(2)} {plant.unit}</b>
            </span>
            <input
              type="range"
              min={plant.spMin}
              max={plant.spMax}
              step={(plant.spMax - plant.spMin) / 200}
              value={setpoint}
              onChange={(e) => changeSetpoint(Number(e.target.value))}
            />
          </label>

          {(["kp", "ki", "kd"] as const).map((k) => (
            <label className="field" key={k}>
              <span>
                {k.toUpperCase()} <b>{gains[k].toFixed(2)}</b>
              </span>
              <input
                type="range"
                min={0}
                max={k === "kp" ? 100 : 40}
                step={0.05}
                value={gains[k]}
                onChange={(e) => changeGains({ ...gains, [k]: Number(e.target.value) })}
              />
            </label>
          ))}

          <div className="buttons">
            <button onClick={() => setRunning((r) => !r)}>
              {running ? "Pause" : "Run"}
            </button>
            <button onClick={injectDisturbance}>Inject disturbance</button>
            <button onClick={() => reset()}>Reset</button>
            <button onClick={() => changeGains(plant.suggestedGains)}>
              Suggested gains
            </button>
          </div>

          <div className="metrics">
            <div className="metric">
              <span>Rise time</span>
              <b>{fmt(metrics.riseTime, 2, " s")}</b>
            </div>
            <div className="metric">
              <span>Overshoot</span>
              <b>{fmt(metrics.overshoot, 1, " %")}</b>
            </div>
            <div className="metric">
              <span>Settling (±2%)</span>
              <b>
                {metrics.settlingTime === null
                  ? "—"
                  : fmt(metrics.settlingTime - simRef.current.lastSpChange, 2, " s")}
              </b>
            </div>
            <div className="metric">
              <span>SS error</span>
              <b>{fmt(metrics.steadyStateError, 3)}</b>
            </div>
            <div className="metric">
              <span>IAE</span>
              <b>{fmt(metrics.iae, 1)}</b>
            </div>
          </div>
        </section>
      </main>

      <footer>
        Try it: set KI to 0 on the heater and watch the steady-state error appear ·
        crank KP on the mass-spring and watch it ring · then hit “Inject disturbance”.
      </footer>
    </div>
  );
}

# PID Lab

An interactive PID tuning simulator: pick a plant, drag the gains, and watch a live oscilloscope respond in real time — rise time, overshoot, settling time, and IAE computed as you tune.

**Live demo:** _(add your Vercel/Pages URL here after deploying)_

This is where my mechatronics degree meets frontend engineering. The physics isn't decorative — it's a real closed-loop simulation with RK4 integration, and the controller implements the details that separate textbook PID from PID that survives contact with hardware.

## What it demonstrates

**Three plants with different control personalities:**

- **Heater block (1st order, self-regulating)** — P-only control visibly leaves a steady-state error; slide KI up and watch it disappear. The classic "why you need the I term" demo.
- **Mass-spring-damper (2nd order)** — crank KP and it rings; add KD and the ringing damps. Overshoot vs. speed, live.
- **Motor position (integrating)** — the plant integrates for you, so P-only reaches zero steady-state error here. Different plant, different rules.

**A PID controller with real-world details:**

- **Anti-windup (conditional integration)** — while the actuator is saturated, the integrator only accepts error that would pull it off the limit. Toggle it off in code and the tests show overshoot and IAE both get worse.
- **Derivative on measurement** — differentiating the error causes an output spike ("derivative kick") on every setpoint step; differentiating the measurement gives the same damping without it. The test suite proves the difference numerically (kick of ~1000 vs ~0).
- **Zero-order hold semantics** — the controller runs at a fixed 20 ms sample time and the continuous plant is integrated between samples with RK4, exactly how a digital controller drives a physical system.

**Disturbance rejection** — hit "Inject disturbance" to apply a load (a cold draft on the heater, a force on the mass) and watch the loop recover. With KI at zero, it doesn't fully recover — which is the point.

## Quick start

```bash
git clone https://github.com/<you>/pid-lab && cd pid-lab
npm install
npm run dev        # http://localhost:5173
```

```bash
npm test           # 9 engine tests — pure Node, no browser needed
npm run typecheck  # strict TS: noUncheckedIndexedAccess and friends
npm run build      # production bundle in dist/
```

## Architecture

```
src/
├── engine/            # pure TypeScript, zero React imports — fully testable in Node
│   ├── pid.ts         # PID w/ saturation, anti-windup, derivative-on-measurement
│   ├── plants.ts      # plant models as ODEs: dx/dt = f(x, u, d)
│   ├── simulate.ts    # RK4 integrator + closed-loop simulation runner
│   └── metrics.ts     # rise time, overshoot, settling time, SSE, IAE
├── components/
│   └── Scope.tsx      # dependency-free canvas oscilloscope (SP/PV + output panes)
├── App.tsx            # live sim loop in requestAnimationFrame, controls, metrics
└── main.tsx
tests/
└── engine.test.ts     # node:test — control theory verified numerically
```

The split matters: the **engine never imports React**, so the physics runs and is tested headlessly with `node --test` — no jsdom, no mocks. The UI is just a window onto the same tested code: the `requestAnimationFrame` loop calls the identical `createPid` / `rk4Step` functions the tests exercise.

## What the tests prove

Not "the function returns a number" tests — numerical verification of control theory:

| Test | What it verifies |
|------|------------------|
| RK4 vs analytic solution | Integrator matches `e^(−t/τ)` to <0.1% |
| P vs PI | P-only leaves >2° steady-state error; PI drives it <0.2° |
| Anti-windup | Under saturation, windup-off has strictly worse overshoot *and* IAE |
| Derivative kick | On-error spikes ~1000 at a setpoint step; on-measurement stays <50 |
| 2nd-order behavior | Higher KP → more overshoot; adding KD → less |
| Integrating plant | P-only reaches ~zero SSE (plant does the integrating) |
| Disturbance rejection | PI recovers to setpoint after a load step; P-only sags |
| Metrics math | First-order response: 0% overshoot, rise time ≈ 2.2τ |

## Deploying (free)

**Vercel:** import the repo at vercel.com — it auto-detects Vite. Done.

**GitHub Pages:** set `base: "/pid-lab/"` in `vite.config.ts`, then:

```bash
npm run build
git subtree push --prefix dist origin gh-pages   # or use actions/deploy-pages
```

Put the URL at the top of this README and on your resume.

## License

MIT

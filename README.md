# Reflexif

Reflexif is a runtime for turning probabilistic AI judgments into stable, testable, and auditable software behavior.

It turns structured state into typed signals, applies deterministic safety gates and temporal evidence rules, then commits an inspectable state transition. Jev is the first decision provider. Normal code remains responsible for policy and actions.

## Current vertical slice

```text
Robot snapshot
  -> decision provider (Jev or mock)
  -> typed semantic signals
  -> deterministic policy gates
  -> temporal stabilization
  -> append-only decision ledger
  -> IDLE | OBSERVING | HANDOFF
```

The included inspector edits a desktop-robot snapshot and displays:

- handoff intent probability
- interaction appropriateness probability
- handoff-intent ambiguity
- every deterministic and semantic gate
- the proposed transition, model, latency, and token usage

Reflexif is not a motor controller or certified safety system. Collision avoidance, joint limits, emergency stops, and actuator control stay deterministic and outside the model.

## Run locally

Requires Node.js 20 or newer.

```bash
npm install
copy .env.example .env.local
npm run dev
```

Set `TYPESAFE_API_KEY` in `.env.local`. `TYPESAFE_MODEL` is pinned to `jev-1.13.0` by default so recorded evaluations remain reproducible. Without an API key, the inspector uses an explicitly labeled deterministic demo model.

Open [http://localhost:3000](http://localhost:3000).

## Validation

```bash
npm test
npm run eval:scenarios
npm run simulate
npm run simulate:faults
npm run replay
npm run lint
npm run build
```

`eval:scenarios` sends ten small live requests to Jev. It checks clear handoffs, ambiguous gestures, absent people, empty robot hands, blocked paths, and out-of-range interactions against expected transitions.

Every successful API evaluation is written to `.reflexif/decisions.jsonl`. `npm run replay` evaluates those stored signal frames with the current policy without calling Jev again. Pass a different JSONL path after `--` when needed.

## Stream stability

```bash
npm run simulate
```

The deterministic stream simulator feeds an oscillating handoff signal into the raw policy and the temporal runtime. The bundled scenario produces four raw transitions and three oscillations; Reflexif reduces that to one stable transition and zero oscillations, with a measured 600 ms decision latency.

Temporal conditions are code-defined and explainable:

```ts
signal("handoffRequested").above(0.75).samples(3, 4)
signal("interactionAppropriate").above(0.8).for(300)
```

The current runtime supports `above`, `below`, `samples`, `for`, `all`, `any`, and `not`, plus handoff hysteresis, cooldown, stale-signal fallback, and sequence-based duplicate/out-of-order rejection. `npm run simulate:faults` applies reproducible signal noise, missing frames, timeouts, duplicates, and delivery delays from a fixed seed. Deterministic safety failures still take effect immediately.

## v0.1

- Live Jev scenario evaluation
- Deterministic policy gates
- Append-only local decision ledger
- Policy replay
- Inspector

## v0.2 — reliable decisions over noisy streams

- Temporal signal conditions
- Hysteresis, cooldown, and staleness
- Deterministic stream simulation
- Stability metrics: transitions, oscillations, false activations, decision latency, and abstention
- Provider-independent evaluation contract and versioned trace metadata
- Seeded signal-noise and provider-failure injection

The next milestone is an event ledger that records temporal state and the final committed decision. Outcome calibration, counterfactual replay, shadow policies, cloud hosting, and the physical robot bridge follow only after stream reliability is measurable.

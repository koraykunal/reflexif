"use client";

import { useRef, useState, type FormEvent } from "react";
import { createTemporalState } from "@/lib/reflexif/temporal";
import type {
  EvaluationErrorResult,
  EvaluationResult,
  RobotMode,
  RobotSnapshot,
} from "@/lib/reflexif/types";

const initialSnapshot: RobotSnapshot = {
  person: {
    visible: true,
    lookingAtRobot: true,
    handExtended: true,
    distanceMeters: 0.7,
  },
  scene: {
    targetObjectVisible: true,
    obstruction: false,
  },
  robot: {
    holding: "screwdriver",
    mode: "OBSERVING",
  },
};

type RequestState = "idle" | "loading" | "success" | "error";

function Toggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="toggle-row">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="toggle-control" aria-hidden="true" />
    </label>
  );
}

function Signal({ label, value }: { label: string; value: number }) {
  const percentage = Math.round(value * 100);

  return (
    <div className="signal">
      <div className="signal-heading">
        <span>{label}</span>
        <strong>{value.toFixed(2)}</strong>
      </div>
      <div
        className="signal-track"
        aria-label={`${label}: ${percentage}%`}
        role="meter"
        aria-valuenow={percentage}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span style={{ width: `${percentage}%` }} />
      </div>
    </div>
  );
}

export function Inspector({ hasApiKey }: { hasApiKey: boolean }) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [requestState, setRequestState] = useState<RequestState>("idle");
  const [result, setResult] = useState<EvaluationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [temporal, setTemporal] = useState(() => createTemporalState(initialSnapshot.robot.mode));
  const sessionId = useRef<string | null>(null);
  const sequence = useRef(0);

  const updatePerson = <K extends keyof RobotSnapshot["person"]>(key: K, value: RobotSnapshot["person"][K]) =>
    setSnapshot((current) => ({ ...current, person: { ...current.person, [key]: value } }));

  const updateScene = <K extends keyof RobotSnapshot["scene"]>(key: K, value: RobotSnapshot["scene"][K]) =>
    setSnapshot((current) => ({ ...current, scene: { ...current.scene, [key]: value } }));

  async function evaluate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRequestState("loading");
    setError(null);

    try {
      const response = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: (sessionId.current ??= crypto.randomUUID()),
          sequence: sequence.current,
          snapshot: {
            ...snapshot,
            robot: { ...snapshot.robot, mode: temporal.committedMode },
          },
        }),
      });
      const payload = (await response.json()) as EvaluationResult | EvaluationErrorResult;

      if ("error" in payload) {
        if (payload.decisionId) sequence.current += 1;
        if (payload.temporalAfter) {
          setTemporal(payload.temporalAfter);
          setResult(null);
        }
        throw new Error(payload.error || "Evaluation failed.");
      }

      if (!response.ok) throw new Error("Evaluation failed.");

      setResult(payload);
      sequence.current += 1;
      setTemporal(payload.temporalAfter);
      setRequestState("success");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Evaluation failed.");
      setRequestState("error");
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Reflexif home">
          reflexif<span>/</span>
        </a>
        <div className="runtime-status" aria-label={hasApiKey ? "Jev is configured" : "Demo mode is active"}>
          <span className="status-dot" />
          {hasApiKey ? "JEV READY" : "DEMO MODE"}
        </div>
      </header>

      <section className="intro" id="top">
        <p className="eyebrow">SEMANTIC CONTROL RUNTIME</p>
        <h1>Decisions you can inspect.</h1>
        <p>Structured state enters. Semantic signals and deterministic policy decide what happens next.</p>
      </section>

      <form className="workbench" onSubmit={evaluate}>
        <section className="panel state-panel" aria-labelledby="state-title">
          <div className="panel-heading">
            <div>
              <span className="panel-index">INPUT</span>
              <h2 id="state-title">World state</h2>
            </div>
            <span className="mono-caption">JSON snapshot</span>
          </div>

          <fieldset>
            <legend>Person</legend>
            <Toggle checked={snapshot.person.visible} label="Visible" onChange={(value) => updatePerson("visible", value)} />
            <Toggle checked={snapshot.person.lookingAtRobot} label="Looking at robot" onChange={(value) => updatePerson("lookingAtRobot", value)} />
            <Toggle checked={snapshot.person.handExtended} label="Hand extended" onChange={(value) => updatePerson("handExtended", value)} />
            <label className="field-row" htmlFor="distance">
              <span>Distance</span>
              <output>{snapshot.person.distanceMeters.toFixed(1)} m</output>
            </label>
            <input
              id="distance"
              className="range"
              type="range"
              min="0.1"
              max="3"
              step="0.1"
              value={snapshot.person.distanceMeters}
              onChange={(event) => updatePerson("distanceMeters", Number(event.target.value))}
            />
          </fieldset>

          <fieldset>
            <legend>Scene</legend>
            <Toggle checked={snapshot.scene.targetObjectVisible} label="Target visible" onChange={(value) => updateScene("targetObjectVisible", value)} />
            <Toggle checked={snapshot.scene.obstruction} label="Path obstructed" onChange={(value) => updateScene("obstruction", value)} />
          </fieldset>

          <fieldset>
            <legend>Robot</legend>
            <label className="input-block" htmlFor="holding">
              <span>Holding</span>
              <input
                id="holding"
                value={snapshot.robot.holding ?? ""}
                placeholder="No object"
                maxLength={64}
                onChange={(event) =>
                  setSnapshot((current) => ({
                    ...current,
                    robot: { ...current.robot, holding: event.target.value || null },
                  }))
                }
              />
            </label>
            <label className="input-block" htmlFor="mode">
              <span>Current mode</span>
              <select
                id="mode"
                value={temporal.committedMode}
                onChange={(event) => {
                  const mode = event.target.value as RobotMode;
                  setSnapshot((current) => ({
                    ...current,
                    robot: { ...current.robot, mode },
                  }));
                  setTemporal(createTemporalState(mode));
                  sessionId.current = null;
                  sequence.current = 0;
                  setResult(null);
                }}
              >
                <option value="IDLE">IDLE</option>
                <option value="OBSERVING">OBSERVING</option>
                <option value="HANDOFF">HANDOFF</option>
              </select>
            </label>
          </fieldset>

          <button className="evaluate-button" type="submit" disabled={requestState === "loading"}>
            {requestState === "loading" ? "Evaluating..." : "Evaluate snapshot"}
          </button>

          {error ? <p className="error-message" role="alert">{error}</p> : null}
        </section>

        <section className="panel signals-panel" aria-labelledby="signals-title" aria-live="polite">
          <div className="panel-heading">
            <div>
              <span className="panel-index">INTERPRETATION</span>
              <h2 id="signals-title">Semantic signals</h2>
            </div>
            {result ? <span className="mono-caption">{result.frame.latencyMs} ms</span> : null}
          </div>

          {requestState === "loading" ? (
            <div className="signal-loading" aria-label="Evaluating semantic signals">
              <span /><span /><span />
            </div>
          ) : result ? (
            <>
              <div className="signal-list">
                <Signal label="Handoff requested" value={result.frame.handoffRequested} />
                <Signal label="Interaction appropriate" value={result.frame.interactionAppropriate} />
                <Signal label="Handoff intent ambiguous" value={result.frame.handoffIntentAmbiguous} />
              </div>
              <dl className="frame-meta">
                <div><dt>Source</dt><dd>{result.frame.source}</dd></div>
                <div><dt>Model</dt><dd>{result.frame.modelVersion}</dd></div>
                <div><dt>Input tokens</dt><dd>{result.frame.inputTokens ?? "local"}</dd></div>
              </dl>
            </>
          ) : (
            <div className="empty-state">
              <span>NO SIGNAL FRAME</span>
              <p>Evaluate the snapshot to produce typed probabilities.</p>
            </div>
          )}
        </section>

        <section className="panel decision-panel" aria-labelledby="decision-title" aria-live="polite">
          <div className="panel-heading">
            <div>
              <span className="panel-index">POLICY + TEMPORAL</span>
              <h2 id="decision-title">Transition</h2>
            </div>
            <span className="mono-caption">
              {temporal.pendingMode ? `PENDING ${temporal.pendingMode}` : `COMMITTED ${temporal.committedMode}`}
            </span>
          </div>

          {result ? (
            <>
              <div className="transition">
                <span>{result.commit.from}</span>
                <span className="transition-arrow">TO</span>
                <strong>{result.commit.to}</strong>
              </div>
              <p className="decision-reason">{result.commit.reason}</p>
              <p className="temporal-summary">
                {temporal.pendingMode
                  ? `${temporal.pendingMode} requires stable evidence before it is committed.`
                  : `Runtime state is ${temporal.committedMode}.`}
              </p>
              <div className="gate-list">
                {result.decision.gates.map((gate) => (
                  <div className="gate" key={gate.label}>
                    <span className={gate.passed ? "gate-state pass" : "gate-state fail"}>{gate.passed ? "PASS" : "HOLD"}</span>
                    <span>{gate.label}</span>
                    <code>{gate.value}</code>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="empty-state">
              <span>POLICY WAITING</span>
              <p>No transition is proposed until signals are available.</p>
            </div>
          )}
        </section>
      </form>
    </main>
  );
}

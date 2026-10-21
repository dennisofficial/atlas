import { useCallback, useEffect, useState } from "react";

export enum EBootState {
  Pending = "pending",
  Running = "running",
  Done = "done",
  Error = "error",
}

export enum EBootOutcome {
  Ready = "ready",
  CloneFails = "clone-fails",
}

export interface BootStepSpec {
  id: string;
  label: string;
  startMs: number;
  durationMs: number;
  detail: (progress: number) => string;
  logs: { at: number; line: string }[];
}

export interface BootStepView {
  spec: BootStepSpec;
  state: EBootState;
  progress: number;
  detail: string;
}

export interface BootView {
  elapsedMs: number;
  state: EBootState;
  steps: BootStepView[];
  logs: string[];
  error: string | null;
  replay: () => void;
}

const TICK_MS = 100;
const CLONE_FAIL_AT = 0.62;
const CLONE_ERROR = "Repository not found, or the GitHub connection can't read it.";

const pct = (progress: number) => `${Math.round(progress * 100)}%`;

export const BOOT_STEPS: BootStepSpec[] = [
  {
    id: "provision",
    label: "Provisioning sandbox",
    startMs: 0,
    durationMs: 2800,
    detail: (p) => (p < 1 ? "Vercel · iad1 · 4 vCPU" : "Vercel · iad1 · 4 vCPU · ready"),
    logs: [
      { at: 0, line: "creating sandbox (4 vCPU, atlas-sandbox:latest)" },
      { at: 0.6, line: "sandbox sbx_9f2k created" },
      { at: 1, line: "drive mounted at /atlas" },
    ],
  },
  {
    id: "serve",
    label: "Downloading Atlas",
    startMs: 2800,
    durationMs: 4200,
    detail: (p) => `atlas-serve 0.42.1 · ${Math.round(p * 61)} / 61 MB`,
    logs: [
      { at: 0, line: "fetching atlas-serve 0.42.1 (linux-x64)" },
      { at: 1, line: "atlas-serve installed, checksum ok" },
    ],
  },
  {
    id: "clone",
    label: "Cloning repository",
    startMs: 2800,
    durationMs: 6000,
    detail: (p) => `dennisofficial/atlas · main · ${pct(p)}`,
    logs: [
      { at: 0, line: "git clone --branch main github.com/dennisofficial/atlas" },
      { at: 0.3, line: "Receiving objects:  31% (24811/80035)" },
      { at: 0.7, line: "Receiving objects:  74% (59226/80035)" },
      { at: 1, line: "Resolving deltas: 100%, done. HEAD at 18c2344" },
    ],
  },
  {
    id: "context",
    label: "Fetching skills and instructions",
    startMs: 2800,
    durationMs: 2400,
    detail: (p) => (p < 1 ? `${Math.round(p * 14)} of 14 files` : "12 skills · ATLAS.md · AGENTS.md"),
    logs: [
      { at: 0, line: "fetching published bundle v37" },
      { at: 1, line: "installed 12 skills, 2 instruction files" },
    ],
  },
  {
    id: "settings",
    label: "Applying settings and secrets",
    startMs: 2800,
    durationMs: 1600,
    detail: (p) => (p < 1 ? "workspace → user → project" : "31 settings · 9 secrets · 2 MCP servers"),
    logs: [
      { at: 0, line: "resolving settings: default < workspace < user < project" },
      { at: 1, line: "wrote settings.json, sealed 9 secrets" },
    ],
  },
  {
    id: "harness",
    label: "Starting the agent",
    startMs: 8800,
    durationMs: 1400,
    detail: (p) => (p < 1 ? "composing harness" : "listening on :4040"),
    logs: [
      { at: 0, line: "composing harness (claude-opus-5, effort high)" },
      { at: 1, line: "serve ready, attaching thread" },
    ],
  },
];

const failsAt = ({ spec, outcome }: { spec: BootStepSpec; outcome: EBootOutcome }) =>
  outcome === EBootOutcome.CloneFails && spec.id === "clone" ? CLONE_FAIL_AT : null;

function stepAt({ spec, elapsedMs, outcome, halted }: {
  spec: BootStepSpec;
  elapsedMs: number;
  outcome: EBootOutcome;
  halted: boolean;
}): BootStepView {
  const raw = (elapsedMs - spec.startMs) / spec.durationMs;
  const progress = Math.max(0, Math.min(1, raw));
  const failure = failsAt({ spec, outcome });
  if (failure !== null && progress >= failure) {
    return { spec, state: EBootState.Error, progress: failure, detail: CLONE_ERROR };
  }
  if (raw <= 0) return { spec, state: EBootState.Pending, progress: 0, detail: "Waiting" };
  if (halted && progress < 1) {
    return { spec, state: EBootState.Pending, progress, detail: "Cancelled" };
  }
  const state = progress >= 1 ? EBootState.Done : EBootState.Running;
  return { spec, state, progress, detail: spec.detail(progress) };
}

const totalMs = Math.max(...BOOT_STEPS.map((spec) => spec.startMs + spec.durationMs));

function logsAt({ steps, elapsedMs }: { steps: BootStepView[]; elapsedMs: number }): string[] {
  return steps
    .flatMap(({ spec, progress, state }) =>
      spec.logs
        .filter((log) => log.at <= progress || (state === EBootState.Running && log.at === 0))
        .map((log) => ({ ms: spec.startMs + log.at * spec.durationMs, line: `${spec.id.padEnd(9)}${log.line}` })),
    )
    .concat(
      steps
        .filter((step) => step.state === EBootState.Error)
        .map((step) => ({ ms: elapsedMs, line: `${step.spec.id.padEnd(9)}error: ${CLONE_ERROR}` })),
    )
    .sort((a, b) => a.ms - b.ms)
    .map((log) => `+${(log.ms / 1000).toFixed(1).padStart(4)}s  ${log.line}`);
}

export function useBootSimulation(outcome: EBootOutcome): BootView {
  const [elapsedMs, setElapsedMs] = useState(0);
  const [failedAtMs, setFailedAtMs] = useState<number | null>(null);

  const now = failedAtMs ?? elapsedMs;
  const steps = BOOT_STEPS.map((spec) =>
    stepAt({ spec, elapsedMs: now, outcome, halted: failedAtMs !== null }),
  );
  const failed = steps.some((step) => step.state === EBootState.Error);
  const finished = now >= totalMs;

  useEffect(() => {
    if (failed && failedAtMs === null) setFailedAtMs(elapsedMs);
  }, [failed, failedAtMs, elapsedMs]);

  useEffect(() => {
    if (failed || finished) return;
    const timer = setInterval(() => setElapsedMs((ms) => ms + TICK_MS), TICK_MS);
    return () => clearInterval(timer);
  }, [failed, finished]);

  const replay = useCallback(() => {
    setElapsedMs(0);
    setFailedAtMs(null);
  }, []);

  const state = failed ? EBootState.Error : finished ? EBootState.Done : EBootState.Running;
  const error = failed ? CLONE_ERROR : null;
  return { elapsedMs: now, state, steps, logs: logsAt({ steps, elapsedMs: now }), error, replay };
}

export function bootTitle(view: BootView): string {
  if (view.state === EBootState.Error) return "Sandbox failed to start";
  if (view.state === EBootState.Done) return "Sandbox ready";
  return "Starting sandbox";
}

export function bootSummary(view: BootView): string {
  const done = view.steps.filter((step) => step.state === EBootState.Done).length;
  return `${done} of ${view.steps.length} · ${(view.elapsedMs / 1000).toFixed(1)}s`;
}

export function overallProgress(view: BootView): number {
  const sum = view.steps.reduce((acc, step) => acc + step.progress, 0);
  return Math.round((sum / view.steps.length) * 100);
}

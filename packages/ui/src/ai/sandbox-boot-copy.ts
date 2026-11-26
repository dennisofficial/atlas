export enum EBootStepState {
  Pending = 'pending',
  Running = 'running',
  Done = 'done',
  Error = 'error',
  Interrupted = 'interrupted',
}

export type SandboxBootSummaryInput = {
  steps: readonly { state: EBootStepState }[]
  state: EBootStepState
  elapsedMs?: number | undefined
}

const TITLES = {
  [EBootStepState.Pending]: 'Waiting for sandbox',
  [EBootStepState.Running]: 'Starting sandbox',
  [EBootStepState.Done]: 'Sandbox ready',
  [EBootStepState.Error]: 'Sandbox failed to start',
  [EBootStepState.Interrupted]: 'Setup restarted · running again',
} as const

export function sandboxBootTitle(state: EBootStepState): string {
  return TITLES[state]
}

export function formatElapsed(elapsedMs: number): string {
  return `${(elapsedMs / 1000).toFixed(1)}s`
}

export function sandboxBootSummary({
  steps,
  state,
  elapsedMs,
}: SandboxBootSummaryInput): string | undefined {
  if (state === EBootStepState.Error || state === EBootStepState.Pending) return undefined
  if (state === EBootStepState.Done) {
    return elapsedMs === undefined ? undefined : formatElapsed(elapsedMs)
  }
  const done = steps.filter((step) => step.state === EBootStepState.Done).length
  const progress = `${done}/${steps.length}`
  return elapsedMs === undefined ? progress : `${progress} · ${formatElapsed(elapsedMs)}`
}

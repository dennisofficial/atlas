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
  [EBootStepState.Interrupted]: 'Setup restarted, running again',
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
  return elapsedMs === undefined ? progress : `${progress}, ${formatElapsed(elapsedMs)}`
}

type BootStepFacts = { state: EBootStepState; detail?: string | undefined }

export type SandboxBootDisplayInput = {
  steps: readonly (BootStepFacts & { children?: readonly BootStepFacts[] | undefined })[]
  state: EBootStepState
  title?: string | undefined
  elapsedMs?: number | undefined
  error?: string | undefined
}

export type SandboxBootDisplay = {
  title: string
  summary: string | undefined
  open: boolean
  headerError: string | undefined
  failed: boolean
}

export const bootStepErrorOf = (step: BootStepFacts): string | undefined =>
  step.state === EBootStepState.Error ? step.detail : undefined

const OPEN_STATES: ReadonlySet<EBootStepState> = new Set([
  EBootStepState.Running,
  EBootStepState.Interrupted,
  EBootStepState.Error,
])

export function sandboxBootDisplayOf(input: SandboxBootDisplayInput): SandboxBootDisplay {
  const { steps, state } = input
  const carried = steps.some(
    (step) =>
      bootStepErrorOf(step) !== undefined ||
      (step.children ?? []).some((child) => bootStepErrorOf(child) !== undefined),
  )
  const failed = state === EBootStepState.Error
  return {
    title: input.title ?? sandboxBootTitle(state),
    summary: sandboxBootSummary({ steps, state, elapsedMs: input.elapsedMs }),
    open: OPEN_STATES.has(state) || carried,
    headerError: failed && !carried ? input.error : undefined,
    failed,
  }
}

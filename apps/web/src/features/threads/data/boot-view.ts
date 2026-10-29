import {
  BOOT_STEP_ORDER,
  EBootStep,
  EBootStepOutcome,
  EBootStepState,
  EPodState,
  foldBootSteps,
  type BootStepEvent,
  type BootStepStatus,
  type PodStatus,
  type RecordedBootStep,
} from '@dltech/atlas-wire/web'

export const FAILED_FALLBACK = 'The sandbox failed to start.'

const BOOT_LABELS: Record<EBootStep, string> = {
  [EBootStep.Provision]: 'Create sandbox',
  [EBootStep.Serve]: 'Start Atlas',
  [EBootStep.Clone]: 'Clone repository',
  [EBootStep.Context]: 'Load skills and instructions',
  [EBootStep.Settings]: 'Apply settings',
  [EBootStep.Agent]: 'Start agent',
}

const OUTCOME_LABELS: Record<EBootStepOutcome, string> = {
  [EBootStepOutcome.Created]: 'Create sandbox',
  [EBootStepOutcome.Resumed]: 'Resume sandbox',
  [EBootStepOutcome.Cloned]: 'Clone repository',
  [EBootStepOutcome.Reused]: 'Reuse repository',
  [EBootStepOutcome.NoRepository]: 'No repository to clone',
}

const RESUMED_CLONE_LABEL = 'Check repository'

function labelOf(args: {
  id: EBootStep
  status: BootStepStatus
  folded: Record<EBootStep, BootStepStatus>
}): string {
  if (args.status.outcome !== undefined) return OUTCOME_LABELS[args.status.outcome]
  const resumed = args.folded[EBootStep.Provision].outcome === EBootStepOutcome.Resumed
  if (args.id === EBootStep.Clone && resumed) return RESUMED_CLONE_LABEL
  return BOOT_LABELS[args.id]
}

export type BootStepView = {
  id: EBootStep
  label: string
  state: EBootStepState
  detail?: string
}

export type BootView = {
  steps: BootStepView[]
  state: EBootStepState
  error?: string
  elapsedMs?: number
  startedAtMs?: number
}

const atOf = (step: RecordedBootStep): number => Date.parse(step.at)

const byAt = (left: RecordedBootStep, right: RecordedBootStep): number => atOf(left) - atOf(right)

const eventOf = (step: RecordedBootStep): BootStepEvent => ({
  step: step.step,
  state: step.state,
  ...(step.error === undefined ? {} : { error: step.error }),
  ...(step.outcome === undefined ? {} : { outcome: step.outcome }),
})

function overallStateOf(steps: readonly BootStepView[]): EBootStepState {
  if (steps.some((step) => step.state === EBootStepState.Error)) return EBootStepState.Error
  if (steps.every((step) => step.state === EBootStepState.Done)) return EBootStepState.Done
  if (steps.some((step) => step.state !== EBootStepState.Pending)) return EBootStepState.Running
  return EBootStepState.Pending
}

function failedAtUnreportedStep(steps: readonly BootStepView[]): BootStepView[] {
  if (steps.some((step) => step.state === EBootStepState.Error)) return [...steps]
  const running = steps.findIndex((step) => step.state === EBootStepState.Running)
  const unfinished = steps.findIndex((step) => step.state !== EBootStepState.Done)
  const index = running !== -1 ? running : unfinished !== -1 ? unfinished : steps.length - 1
  return steps.map((step, position) =>
    position === index ? { ...step, state: EBootStepState.Error, detail: FAILED_FALLBACK } : step,
  )
}

function elapsedOf(args: {
  state: EBootStepState
  attempt: readonly RecordedBootStep[]
  now: number
}): number | undefined {
  const first = args.attempt[0]
  const last = args.attempt.at(-1)
  if (first === undefined || last === undefined) return undefined
  if (args.state === EBootStepState.Done) return Math.max(0, atOf(last) - atOf(first))
  if (args.state === EBootStepState.Running) return Math.max(0, args.now - atOf(first))
  return undefined
}

function attemptViewOf(args: {
  steps: readonly RecordedBootStep[]
  failed: boolean
  now: number
}): BootView {
  const attempt = [...args.steps].sort(byAt)
  const folded = foldBootSteps(attempt.map(eventOf))
  const recorded = BOOT_STEP_ORDER.map((id): BootStepView => {
    const status = folded[id]
    const detail = status.state === EBootStepState.Error ? status.error : undefined
    return {
      id,
      label: labelOf({ id, status, folded }),
      state: status.state,
      ...(detail === undefined ? {} : { detail }),
    }
  })
  const steps = args.failed ? failedAtUnreportedStep(recorded) : recorded
  const state = overallStateOf(steps)
  const error = steps.find((step) => step.state === EBootStepState.Error)?.detail
  const elapsedMs = elapsedOf({ state, attempt, now: args.now })
  const first = attempt[0]
  const running = state === EBootStepState.Running && first !== undefined
  return {
    steps,
    state,
    ...(error === undefined ? {} : { error }),
    ...(elapsedMs === undefined ? {} : { elapsedMs }),
    ...(running ? { startedAtMs: atOf(first) } : {}),
  }
}

export function bootViewOf(args: { pod: PodStatus | null; now: number }): BootView | null {
  const { pod } = args
  if (pod === null || pod.state === EPodState.None || pod.state === EPodState.Parked) return null
  if (pod.state === EPodState.Running && pod.steps.length === 0) return null
  return attemptViewOf({
    steps: pod.steps,
    failed: pod.state === EPodState.Failed,
    now: args.now,
  })
}

export function settledBootViewOf(attempt: readonly RecordedBootStep[]): BootView {
  const folded = foldBootSteps(attempt.map(eventOf))
  const finished = BOOT_STEP_ORDER.every((id) => folded[id].state === EBootStepState.Done)
  return attemptViewOf({ steps: attempt, failed: !finished, now: 0 })
}

export const isPodFailed = (pod: PodStatus | null): boolean => pod?.state === EPodState.Failed

export function isPodSettled(pod: PodStatus): boolean {
  if (pod.state === EPodState.Failed || pod.state === EPodState.Parked) return true
  if (pod.state !== EPodState.Running) return false
  if (pod.steps.length === 0) return true
  return foldBootSteps(pod.steps.map(eventOf))[EBootStep.Agent].state === EBootStepState.Done
}

export const isPodLiveEligible = (pod: PodStatus | null): boolean =>
  pod !== null && pod.state === EPodState.Running && isPodSettled(pod)

import {
  BOOT_STEP_ORDER,
  EBootStep,
  EBootStepState,
  EPodState,
  foldBootSteps,
  type BootStepEvent,
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
}

const atOf = (step: RecordedBootStep): number => Date.parse(step.at)

const byAt = (left: RecordedBootStep, right: RecordedBootStep): number => atOf(left) - atOf(right)

const eventOf = (step: RecordedBootStep): BootStepEvent => ({
  step: step.step,
  state: step.state,
  ...(step.error === undefined ? {} : { error: step.error }),
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

export function bootViewOf(args: { pod: PodStatus | null; now: number }): BootView | null {
  const { pod } = args
  if (pod === null || pod.state === EPodState.None || pod.state === EPodState.Parked) return null
  if (pod.state === EPodState.Running && pod.steps.length === 0) return null
  const attempt = [...pod.steps].sort(byAt)
  const folded = foldBootSteps(attempt.map(eventOf))
  const recorded = BOOT_STEP_ORDER.map((id): BootStepView => {
    const status = folded[id]
    const detail = status.state === EBootStepState.Error ? status.error : undefined
    return {
      id,
      label: BOOT_LABELS[id],
      state: status.state,
      ...(detail === undefined ? {} : { detail }),
    }
  })
  const steps = pod.state === EPodState.Failed ? failedAtUnreportedStep(recorded) : recorded
  const state = overallStateOf(steps)
  const error = steps.find((step) => step.state === EBootStepState.Error)?.detail
  const elapsedMs = elapsedOf({ state, attempt, now: args.now })
  return {
    steps,
    state,
    ...(error === undefined ? {} : { error }),
    ...(elapsedMs === undefined ? {} : { elapsedMs }),
  }
}

export const isPodFailed = (pod: PodStatus | null): boolean => pod?.state === EPodState.Failed

export function isPodSettled(pod: PodStatus): boolean {
  if (pod.state === EPodState.Failed || pod.state === EPodState.Parked) return true
  if (pod.state !== EPodState.Running) return false
  if (pod.steps.length === 0) return true
  return foldBootSteps(pod.steps.map(eventOf))[EBootStep.Agent].state === EBootStepState.Done
}

export function shouldPollPod(args: { pod: PodStatus | null; awaitingRun: boolean }): boolean {
  const { pod } = args
  if (pod === null) return true
  if (pod.state === EPodState.None) return args.awaitingRun
  return !isPodSettled(pod)
}

export const isPodLiveEligible = (pod: PodStatus | null): boolean =>
  pod !== null && pod.state === EPodState.Running && isPodSettled(pod)

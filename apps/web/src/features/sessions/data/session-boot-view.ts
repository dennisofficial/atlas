import {
  EWorkspaceStep,
  EWorkspaceStepOutcome,
  EWorkspaceStepState,
  ESessionStatus,
  WORKSPACE_STEP_ORDER,
  workspaceStepsOf,
  type V2Event,
  type WorkspaceStepStatus,
} from '@dltech/atlas-core'
import type { SessionSnapshot } from '@dltech/atlas-client/stream'
import { EBootStep, EBootStepState } from '@dltech/atlas-wire/web'

import type { BootStepView, BootView } from '@/features/threads/data/boot-view'

const BOOT_STEP: Record<EWorkspaceStep, EBootStep> = {
  [EWorkspaceStep.Sandbox]: EBootStep.Provision,
  [EWorkspaceStep.Daemon]: EBootStep.Serve,
  [EWorkspaceStep.Clone]: EBootStep.Clone,
  [EWorkspaceStep.Setup]: EBootStep.Setup,
}

const ACTIVE_LABELS: Record<EWorkspaceStep, string> = {
  [EWorkspaceStep.Sandbox]: 'Starting sandbox',
  [EWorkspaceStep.Daemon]: 'Starting daemon',
  [EWorkspaceStep.Clone]: 'Cloning repository',
  [EWorkspaceStep.Setup]: 'Running setup script',
}

const DONE_LABELS: Record<EWorkspaceStep, string> = {
  [EWorkspaceStep.Sandbox]: 'Sandbox started',
  [EWorkspaceStep.Daemon]: 'Daemon started',
  [EWorkspaceStep.Clone]: 'Repository cloned',
  [EWorkspaceStep.Setup]: 'Setup script ran',
}

const SKIPPED_LABELS: Record<EWorkspaceStep, string> = {
  [EWorkspaceStep.Sandbox]: 'Sandbox started',
  [EWorkspaceStep.Daemon]: 'Daemon started',
  [EWorkspaceStep.Clone]: 'Repository already there',
  [EWorkspaceStep.Setup]: 'No setup needed',
}

const doneLabelOf = (args: {
  step: EWorkspaceStep
  outcome: EWorkspaceStepOutcome | undefined
}) => {
  if (args.outcome === EWorkspaceStepOutcome.Resumed) return 'Sandbox resumed'
  if (args.outcome === EWorkspaceStepOutcome.Skipped) return SKIPPED_LABELS[args.step]
  return DONE_LABELS[args.step]
}

type Phase = 'live' | 'failed' | 'settled'

const phaseOf = (status: SessionSnapshot['status']): Phase => {
  if (status?.state === ESessionStatus.Preparing) return 'live'
  if (status?.state === ESessionStatus.SetupFailed) return 'failed'
  return 'settled'
}

const stateOf = (args: {
  recorded: WorkspaceStepStatus | undefined
  phase: Phase
  previousDone: boolean
}): EBootStepState => {
  const { recorded, phase } = args
  if (recorded?.state === EWorkspaceStepState.Done) return EBootStepState.Done
  if (recorded?.state === EWorkspaceStepState.Failed && phase === 'failed') {
    return EBootStepState.Error
  }
  if (recorded?.state === EWorkspaceStepState.Started) {
    return phase === 'live' ? EBootStepState.Running : EBootStepState.Error
  }
  if (phase === 'settled') return EBootStepState.Done
  return phase === 'live' && args.previousDone ? EBootStepState.Running : EBootStepState.Pending
}

const stepViewOf = (args: {
  step: EWorkspaceStep
  recorded: WorkspaceStepStatus | undefined
  state: EBootStepState
}): BootStepView => {
  const { step, recorded, state } = args
  const label =
    state === EBootStepState.Done
      ? doneLabelOf({ step, outcome: recorded?.outcome })
      : ACTIVE_LABELS[step]
  const detail = state === EBootStepState.Error ? recorded?.reason : undefined
  return {
    id: BOOT_STEP[step],
    label,
    state,
    ...(detail === undefined ? {} : { detail }),
  }
}

const withFailureReason = (args: {
  steps: BootStepView[]
  reason: string | undefined
}): BootStepView[] => {
  if (args.steps.some((step) => step.state === EBootStepState.Error)) return args.steps
  const index = args.steps.findIndex((step) => step.state !== EBootStepState.Done)
  const target = index === -1 ? args.steps.length - 1 : index
  return args.steps.map((step, position) =>
    position === target
      ? { ...step, state: EBootStepState.Error, ...(args.reason ? { detail: args.reason } : {}) }
      : step,
  )
}

const overallOf = (steps: readonly BootStepView[]): EBootStepState => {
  if (steps.some((step) => step.state === EBootStepState.Error)) return EBootStepState.Error
  if (steps.every((step) => step.state === EBootStepState.Done)) return EBootStepState.Done
  if (steps.some((step) => step.state !== EBootStepState.Pending)) {
    return EBootStepState.Running
  }
  return EBootStepState.Pending
}

const atMsOf = (step: WorkspaceStepStatus | undefined): number | undefined => {
  const parsed = Date.parse(step?.at ?? '')
  return Number.isNaN(parsed) ? undefined : parsed
}

export const sessionBootViewOf = (args: {
  events: readonly V2Event[]
  status: SessionSnapshot['status']
}): BootView | null => {
  const folded = workspaceStepsOf(args.events)
  const recordedSteps = WORKSPACE_STEP_ORDER.map((step) => folded[step])
  const phase = phaseOf(args.status)
  if (phase === 'settled' && recordedSteps.every((step) => step === undefined)) return null
  if (phase === 'settled' && args.status === undefined) return null

  let previousDone = true
  let steps = WORKSPACE_STEP_ORDER.map((step, index): BootStepView => {
    const recorded = recordedSteps[index]
    const state = stateOf({ recorded, phase, previousDone })
    previousDone = state === EBootStepState.Done
    return stepViewOf({ step, recorded, state })
  })
  if (phase === 'failed') steps = withFailureReason({ steps, reason: args.status?.reason })

  const state = overallOf(steps)
  const times = recordedSteps.map(atMsOf).filter((value): value is number => value !== undefined)
  const first = times.length === 0 ? undefined : Math.min(...times)
  const last = times.length === 0 ? undefined : Math.max(...times)
  const error = steps.find((step) => step.state === EBootStepState.Error)?.detail
  return {
    steps,
    state,
    ...(error === undefined ? {} : { error }),
    ...(state === EBootStepState.Done && first !== undefined && last !== undefined
      ? { elapsedMs: Math.max(0, last - first) }
      : {}),
    ...(state === EBootStepState.Running && first !== undefined ? { startedAtMs: first } : {}),
  }
}

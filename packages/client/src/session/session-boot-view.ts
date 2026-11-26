import {
  EWorkspaceRepoState,
  EWorkspaceStep,
  EWorkspaceStepOutcome,
  EWorkspaceStepState,
  ESessionStatus,
  WORKSPACE_STEP_ORDER,
  workspaceStepsOf,
  type RecordEvent,
  type WorkspaceStepStatus,
} from '@dltech/atlas-core'
import { EBootStep, EBootStepState } from '@dltech/atlas-wire/web'

import type { SessionSnapshot } from '../stream'

export type BootStepChild = {
  id: string
  label: string
  state: EBootStepState
  detail?: string
}

export type BootStepView = {
  id: EBootStep
  label: string
  state: EBootStepState
  detail?: string
  children?: BootStepChild[]
  command?: string
  output?: string
}

export type BootView = {
  steps: BootStepView[]
  state: EBootStepState
  title?: string
  error?: string
  elapsedMs?: number
  startedAtMs?: number
}

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

const INTERRUPTED_LABELS: Record<EWorkspaceStep, string> = {
  [EWorkspaceStep.Sandbox]: 'Sandbox restarted · starting again',
  [EWorkspaceStep.Daemon]: 'Daemon restarted · starting again',
  [EWorkspaceStep.Clone]: 'Clone interrupted · running again',
  [EWorkspaceStep.Setup]: 'Setup restarted · running again',
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

const REPO_STATE: Record<EWorkspaceRepoState, EBootStepState> = {
  [EWorkspaceRepoState.Pending]: EBootStepState.Pending,
  [EWorkspaceRepoState.Cloning]: EBootStepState.Running,
  [EWorkspaceRepoState.Done]: EBootStepState.Done,
  [EWorkspaceRepoState.Failed]: EBootStepState.Error,
}

type Phase = 'live' | 'failed' | 'catching-up' | 'settled'

const BOOT_ENDS: ReadonlySet<RecordEvent['type']> = new Set<RecordEvent['type']>([
  'workspace-prepared',
  'workspace-prepare-failed',
  'session-start-failed',
  'user-said',
])

const bootInFlightOf = (events: readonly RecordEvent[]): boolean => {
  const start = events.findLastIndex((event) => event.type === 'workspace-attempt-started')
  if (start === -1) return false
  return !events.slice(start + 1).some((event) => BOOT_ENDS.has(event.type))
}

const phaseOf = (args: {
  status: SessionSnapshot['status']
  catchingUp: boolean
  inFlight: boolean
}): Phase => {
  if (args.status?.state === ESessionStatus.Preparing) return 'live'
  if (args.status?.state === ESessionStatus.SetupFailed) return 'failed'
  if (args.catchingUp) return 'catching-up'
  if (args.inFlight) return 'live'
  return 'settled'
}

const stateOf = (args: {
  step: EWorkspaceStep
  recorded: WorkspaceStepStatus | undefined
  phase: Phase
  previousDone: boolean
}): EBootStepState => {
  const { recorded, phase } = args
  if (recorded?.state === EWorkspaceStepState.Done) return EBootStepState.Done
  if (recorded?.state === EWorkspaceStepState.Failed) return EBootStepState.Error
  if (recorded?.state === EWorkspaceStepState.Interrupted) return EBootStepState.Interrupted
  if (recorded?.state === EWorkspaceStepState.Started) {
    const runsPastPrepare = args.step === EWorkspaceStep.Setup && phase === 'settled'
    return phase === 'live' || phase === 'catching-up' || runsPastPrepare
      ? EBootStepState.Running
      : EBootStepState.Error
  }
  if (phase === 'catching-up') return EBootStepState.Pending
  if (phase === 'settled') {
    return args.previousDone ? EBootStepState.Done : EBootStepState.Pending
  }
  return EBootStepState.Pending
}

const repoChildrenOf = (recorded: WorkspaceStepStatus | undefined): BootStepChild[] | undefined =>
  recorded?.repos?.map(({ repo, state, reason }) => ({
    id: repo,
    label: repo.slice(repo.lastIndexOf('/') + 1),
    state: REPO_STATE[state],
    ...(reason === undefined ? {} : { detail: reason }),
  }))

const outputOf = (args: {
  recorded: WorkspaceStepStatus
  state: EBootStepState
  liveOutput: string | undefined
}): string | undefined =>
  args.state === EBootStepState.Running || args.state === EBootStepState.Interrupted
    ? (args.liveOutput ?? args.recorded.output)
    : args.recorded.output

const stepViewOf = (args: {
  step: EWorkspaceStep
  recorded: WorkspaceStepStatus | undefined
  state: EBootStepState
  liveOutput: string | undefined
}): BootStepView => {
  const { step, recorded, state } = args
  const children = step === EWorkspaceStep.Clone ? repoChildrenOf(recorded) : undefined
  const command = step === EWorkspaceStep.Setup ? recorded?.command : undefined
  const output =
    command === undefined || recorded === undefined
      ? undefined
      : outputOf({ recorded, state, liveOutput: args.liveOutput })
  const label =
    state === EBootStepState.Done
      ? doneLabelOf({ step, outcome: recorded?.outcome })
      : state === EBootStepState.Interrupted
        ? INTERRUPTED_LABELS[step]
        : ACTIVE_LABELS[step]
  const detail = state === EBootStepState.Error ? recorded?.reason : undefined
  return {
    id: BOOT_STEP[step],
    label,
    state,
    ...(detail === undefined ? {} : { detail }),
    ...(children === undefined || children.length === 0 ? {} : { children }),
    ...(command === undefined ? {} : { command }),
    ...(output === undefined || output === '' ? {} : { output }),
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

const SETUP_FAILED_TITLE = 'Setup script failed'

const onlySetupFailed = (steps: readonly BootStepView[]): boolean =>
  steps.every((step) =>
    step.id === EBootStep.Setup
      ? step.state === EBootStepState.Error
      : step.state === EBootStepState.Done,
  )

const atMsOf = (step: WorkspaceStepStatus | undefined): number | undefined => {
  const parsed = Date.parse(step?.at ?? '')
  return Number.isNaN(parsed) ? undefined : parsed
}

export const sessionBootViewOf = (args: {
  events: readonly RecordEvent[]
  status: SessionSnapshot['status']
  setupOutput?: string | undefined
  catchingUp?: boolean
}): BootView | null => {
  const folded = workspaceStepsOf(args.events)
  const recordedSteps = WORKSPACE_STEP_ORDER.map((step) => folded[step])
  const phase = phaseOf({
    status: args.status,
    catchingUp: args.catchingUp === true,
    inFlight: bootInFlightOf(args.events),
  })
  const settling = phase === 'settled' || phase === 'catching-up'
  if (settling && recordedSteps.every((step) => step === undefined)) return null
  if (phase === 'settled' && args.status === undefined) return null

  let previousDone = true
  let steps = WORKSPACE_STEP_ORDER.map((step, index): BootStepView => {
    const recorded = recordedSteps[index]
    const state = stateOf({ step, recorded, phase, previousDone })
    previousDone = state === EBootStepState.Done
    return stepViewOf({ step, recorded, state, liveOutput: args.setupOutput })
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
    ...(onlySetupFailed(steps) ? { title: SETUP_FAILED_TITLE } : {}),
    ...(error === undefined ? {} : { error }),
    ...(state === EBootStepState.Done && first !== undefined && last !== undefined
      ? { elapsedMs: Math.max(0, last - first) }
      : {}),
    ...(state === EBootStepState.Running && first !== undefined ? { startedAtMs: first } : {}),
  }
}

export const bootViewAt = (args: { view: BootView; now: number }): BootView =>
  args.view.startedAtMs === undefined
    ? args.view
    : { ...args.view, elapsedMs: Math.max(0, args.now - args.view.startedAtMs) }

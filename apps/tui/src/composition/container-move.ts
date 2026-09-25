import { EExecutionLocation } from '@dltech/atlas-core'
import { EDescendStep, ELiftStep } from '@dltech/atlas-harness'

export enum ELocalMoveStep {
  Stopping = 'stopping',
  Flipping = 'flipping',
  Relocating = 'relocating',
}

export enum EStepMark {
  Pending = 'pending',
  Active = 'active',
  Done = 'done',
  Failed = 'failed',
}

export type MoveStepId = ELiftStep | EDescendStep | ELocalMoveStep

export type MoveStep = {
  id: MoveStepId
  text: string
  mark: EStepMark
}

export type ContainerMove = {
  target: EExecutionLocation
  steps: readonly MoveStep[]
  heading?: string | undefined
  startedAt: number
  activeSince: number
  failure: string | null
}

const STEP_TEXT: Record<MoveStepId, string> = {
  [ELiftStep.Interrupting]: 'interrupting the turn at a clean break',
  [ELiftStep.Stopping]: 'closing what is running here',
  [ELiftStep.Transferring]: 'transferring the conversation',
  [ELiftStep.Flipping]: 'handing the conversation over',
  [ELiftStep.Capturing]: 'packing the uncommitted work',
  [ELiftStep.Starting]: 'waiting for the sandbox',
  [ELiftStep.UploadingContext]: 'sending skills and memory to the sandbox',
  [ELiftStep.Attaching]: 'attaching to the sandbox',
  [ELiftStep.Resuming]: 'resuming the turn in the cloud',
  [ELocalMoveStep.Relocating]: 'stopping services, moving sub-agents',
}

const CLOUD_PLAN: readonly MoveStepId[] = [
  ELiftStep.Stopping,
  ELiftStep.Transferring,
  ELiftStep.Flipping,
  ELiftStep.Capturing,
  ELiftStep.Starting,
  ELiftStep.UploadingContext,
  ELiftStep.Attaching,
]

export const cloudLiftPlan = (args: { midTurn: boolean }): readonly MoveStepId[] =>
  args.midTurn ? [ELiftStep.Interrupting, ...CLOUD_PLAN, ELiftStep.Resuming] : CLOUD_PLAN

const LOCAL_PLAN: readonly MoveStepId[] = [
  ELocalMoveStep.Stopping,
  ELocalMoveStep.Flipping,
  ELocalMoveStep.Relocating,
]

export const descendPlanOf = (
  steps: readonly (ELiftStep.Interrupting | EDescendStep)[],
): readonly MoveStepId[] => steps

export const WAKE_PLAN: readonly MoveStepId[] = [ELiftStep.Starting, ELiftStep.Attaching]

export const WAKE_HEADING = 'WAKING THE SANDBOX'

const planFor = (target: EExecutionLocation): readonly MoveStepId[] =>
  target === EExecutionLocation.Cloud ? CLOUD_PLAN : LOCAL_PLAN

const stepOf = (args: { id: MoveStepId; mark: EStepMark }): MoveStep => ({
  id: args.id,
  text: STEP_TEXT[args.id],
  mark: args.mark,
})

export function beginMove(args: {
  target: EExecutionLocation
  now: number
  plan?: readonly MoveStepId[] | undefined
  heading?: string | undefined
}): ContainerMove {
  const plan = args.plan ?? planFor(args.target)
  return {
    target: args.target,
    steps: plan.map((id, index) =>
      stepOf({ id, mark: index === 0 ? EStepMark.Active : EStepMark.Pending }),
    ),
    ...(args.heading === undefined ? {} : { heading: args.heading }),
    startedAt: args.now,
    activeSince: args.now,
    failure: null,
  }
}

export function advanceMove(args: {
  move: ContainerMove
  step: MoveStepId
  now: number
}): ContainerMove {
  const reached = args.move.steps.findIndex((step) => step.id === args.step)
  if (reached === -1) return args.move

  return {
    ...args.move,
    steps: args.move.steps.map((step, index) => {
      if (index < reached) return { ...step, mark: EStepMark.Done }
      if (index === reached) return { ...step, mark: EStepMark.Active }
      return step
    }),
    activeSince: args.now,
  }
}

export function failMove(args: { move: ContainerMove; reason: string }): ContainerMove {
  return {
    ...args.move,
    steps: args.move.steps.map((step) =>
      step.mark === EStepMark.Active ? { ...step, mark: EStepMark.Failed } : step,
    ),
    failure: args.reason,
  }
}

const HEADING: Record<EExecutionLocation, string> = {
  [EExecutionLocation.Cloud]: 'MOVING TO THE CLOUD',
  [EExecutionLocation.Docker]: 'MOVING INTO A DOCKER CONTAINER',
  [EExecutionLocation.Host]: 'MOVING BACK TO THE HOST',
}

export const moveHeading = (target: EExecutionLocation): string => HEADING[target]

import { EExecutionLocation } from '@dltech/atlas-core'

import { ELiftStep } from './cloud/lift'

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

export type MoveStepId = ELiftStep | ELocalMoveStep

export type MoveStep = {
  id: MoveStepId
  text: string
  mark: EStepMark
}

export type ContainerMove = {
  target: EExecutionLocation
  steps: readonly MoveStep[]
  startedAt: number
  activeSince: number
  failure: string | null
}

const STEP_TEXT: Record<MoveStepId, string> = {
  [ELiftStep.Transferring]: 'transferring the conversation',
  [ELiftStep.Flipping]: 'handing the conversation over',
  [ELiftStep.Stopping]: 'closing what is running here',
  [ELiftStep.Capturing]: 'packing the uncommitted work',
  [ELiftStep.Starting]: 'waiting for the sandbox',
  [ELiftStep.Attaching]: 'attaching to the sandbox',
  [ELocalMoveStep.Relocating]: 'stopping services, moving sub-agents',
}

const CLOUD_PLAN: readonly MoveStepId[] = [
  ELiftStep.Transferring,
  ELiftStep.Flipping,
  ELiftStep.Stopping,
  ELiftStep.Capturing,
  ELiftStep.Starting,
  ELiftStep.Attaching,
]

const LOCAL_PLAN: readonly MoveStepId[] = [
  ELocalMoveStep.Stopping,
  ELocalMoveStep.Flipping,
  ELocalMoveStep.Relocating,
]

const planFor = (target: EExecutionLocation): readonly MoveStepId[] =>
  target === EExecutionLocation.Cloud ? CLOUD_PLAN : LOCAL_PLAN

const stepOf = (args: { id: MoveStepId; mark: EStepMark }): MoveStep => ({
  id: args.id,
  text: STEP_TEXT[args.id],
  mark: args.mark,
})

export function beginMove(args: { target: EExecutionLocation; now: number }): ContainerMove {
  return {
    target: args.target,
    steps: planFor(args.target).map((id, index) =>
      stepOf({ id, mark: index === 0 ? EStepMark.Active : EStepMark.Pending }),
    ),
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

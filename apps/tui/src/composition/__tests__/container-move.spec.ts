import { describe, expect, it } from 'bun:test'

import { EExecutionLocation } from '@dltech/atlas-core'

import { ELiftStep } from '@dltech/atlas-harness'
import {
  advanceMove,
  beginMove,
  cloudLiftPlan,
  ELocalMoveStep,
  EStepMark,
  failMove,
  moveHeading,
} from '../container-move'

const STARTED_AT = 10_000

describe('the steps a move narrates', () => {
  it('mirrors the lift when the target is the cloud', () => {
    const move = beginMove({ target: EExecutionLocation.Cloud, now: STARTED_AT })

    expect(move.steps.map((step) => step.id)).toEqual([
      ELiftStep.Stopping,
      ELiftStep.Transferring,
      ELiftStep.Flipping,
      ELiftStep.Capturing,
      ELiftStep.Starting,
      ELiftStep.UploadingContext,
      ELiftStep.Attaching,
    ])
  })

  it('closes, hands over and relocates when the target is docker or the host', () => {
    for (const target of [EExecutionLocation.Docker, EExecutionLocation.Host]) {
      const move = beginMove({ target, now: STARTED_AT })

      expect(move.steps.map((step) => step.id)).toEqual([
        ELocalMoveStep.Stopping,
        ELocalMoveStep.Flipping,
        ELocalMoveStep.Relocating,
      ])
    }
  })

  it('starts on the first step with the rest waiting', () => {
    const move = beginMove({ target: EExecutionLocation.Cloud, now: STARTED_AT })

    expect(move.steps.map((step) => step.mark)).toEqual([
      EStepMark.Active,
      EStepMark.Pending,
      EStepMark.Pending,
      EStepMark.Pending,
      EStepMark.Pending,
      EStepMark.Pending,
      EStepMark.Pending,
    ])
    expect(move.startedAt).toBe(STARTED_AT)
    expect(move.activeSince).toBe(STARTED_AT)
    expect(move.failure).toBeNull()
  })
})

describe('advancing through a move', () => {
  it('marks the steps before the one it reached done and that one active', () => {
    const begun = beginMove({ target: EExecutionLocation.Cloud, now: STARTED_AT })

    const move = advanceMove({ move: begun, step: ELiftStep.Starting, now: STARTED_AT + 4_000 })

    expect(move.steps.map((step) => step.mark)).toEqual([
      EStepMark.Done,
      EStepMark.Done,
      EStepMark.Done,
      EStepMark.Done,
      EStepMark.Active,
      EStepMark.Pending,
      EStepMark.Pending,
    ])
    expect(move.activeSince).toBe(STARTED_AT + 4_000)
    expect(move.startedAt).toBe(STARTED_AT)
  })
})

describe('a move that does not finish', () => {
  it('fails the step it was on and keeps the reason', () => {
    const begun = beginMove({ target: EExecutionLocation.Cloud, now: STARTED_AT })
    const starting = advanceMove({ move: begun, step: ELiftStep.Starting, now: STARTED_AT + 4_000 })

    const move = failMove({ move: starting, reason: 'no capacity in iad1' })

    expect(move.steps.map((step) => step.mark)).toEqual([
      EStepMark.Done,
      EStepMark.Done,
      EStepMark.Done,
      EStepMark.Done,
      EStepMark.Failed,
      EStepMark.Pending,
      EStepMark.Pending,
    ])
    expect(move.failure).toBe('no capacity in iad1')
  })
})

describe('the heading over the steps', () => {
  it('names where the conversation is going', () => {
    expect(moveHeading(EExecutionLocation.Cloud)).toBe('MOVING TO THE CLOUD')
    expect(moveHeading(EExecutionLocation.Docker)).toBe('MOVING INTO A DOCKER CONTAINER')
    expect(moveHeading(EExecutionLocation.Host)).toBe('MOVING BACK TO THE HOST')
  })
})

describe('the plan a cloud lift narrates', () => {
  it('is the plain seven steps when nothing was running', () => {
    expect(cloudLiftPlan({ midTurn: false })).toEqual([
      ELiftStep.Stopping,
      ELiftStep.Transferring,
      ELiftStep.Flipping,
      ELiftStep.Capturing,
      ELiftStep.Starting,
      ELiftStep.UploadingContext,
      ELiftStep.Attaching,
    ])
  })

  it('bookends the plan with interrupting and resuming when a turn was in flight', () => {
    expect(cloudLiftPlan({ midTurn: true })).toEqual([
      ELiftStep.Interrupting,
      ELiftStep.Stopping,
      ELiftStep.Transferring,
      ELiftStep.Flipping,
      ELiftStep.Capturing,
      ELiftStep.Starting,
      ELiftStep.UploadingContext,
      ELiftStep.Attaching,
      ELiftStep.Resuming,
    ])
  })
})

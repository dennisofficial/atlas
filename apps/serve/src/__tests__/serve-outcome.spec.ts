import { describe, expect, it } from 'bun:test'

import { ERunFailureKind, toRunId } from '@dltech/atlas-core'
import { ETurnStatus } from '@dltech/atlas-harness'
import { turnOutcomeWireSchema } from '@dltech/atlas-wire'

import { wireOutcomeOf } from '../serve-outcome'

describe('wireOutcomeOf', () => {
  it('carries a structured failure on a failed outcome', () => {
    const wire = wireOutcomeOf({
      status: ETurnStatus.Failed,
      runId: toRunId('run-1'),
      message: 'boom',
      cause: undefined,
    })

    expect(wire).toMatchObject({
      status: ETurnStatus.Failed,
      message: 'boom',
      failure: { kind: ERunFailureKind.Other, message: 'boom' },
    })
    expect(turnOutcomeWireSchema.safeParse(wire).success).toBe(true)
  })

  it('passes non-failed outcomes through', () => {
    const outcome = {
      status: ETurnStatus.Idle,
      runId: toRunId('run-2'),
    } as const
    expect(wireOutcomeOf(outcome)).toEqual(outcome)
  })
})

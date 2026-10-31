import { describe, expect, it } from 'bun:test'

import { ETurnStatus, turnOutcomeWireSchema } from '../index'

const base = { status: ETurnStatus.Failed, runId: 'run-1', message: 'boom' }

describe('failed outcome wire', () => {
  it('accepts an outcome from an older serve without failure', () => {
    expect(turnOutcomeWireSchema.safeParse(base).success).toBe(true)
  })

  it('keeps a structured failure', () => {
    const failure = { kind: 'quota', message: 'out', statusCode: 402 }
    expect(turnOutcomeWireSchema.parse({ ...base, failure })).toMatchObject({
      failure,
    })
  })
})

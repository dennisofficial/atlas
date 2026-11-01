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

  it('keeps retryAt and resetAt on the failure', () => {
    const failure = {
      kind: 'quota',
      message: 'out',
      retryAt: '2026-10-31T12:00:00.000Z',
      resetAt: '2026-11-01T00:00:00+02:00',
    }
    expect(turnOutcomeWireSchema.parse({ ...base, failure })).toMatchObject({ failure })
  })

  it.each(['delivery', 'model-denied', 'from-the-future'])('accepts the %s kind', (kind) => {
    const failure = { kind, message: 'x' }
    expect(turnOutcomeWireSchema.parse({ ...base, failure })).toMatchObject({ failure })
  })

  it('rejects a retryAt that is not an ISO instant', () => {
    const failure = { kind: 'quota', message: 'out', retryAt: 'soon' }
    expect(turnOutcomeWireSchema.safeParse({ ...base, failure }).success).toBe(false)
  })
})

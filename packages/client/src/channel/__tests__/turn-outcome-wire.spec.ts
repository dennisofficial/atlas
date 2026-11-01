import { describe, expect, it } from 'bun:test'

import { ERunFailureKind, toRunId } from '@dltech/atlas-core'

import { turnOutcomeWireSchema } from '@dltech/atlas-wire/web'

import { turnOutcomeFromWire } from '../channel-wire'
import { ETurnStatus } from '../turn-outcome'

describe('turnOutcomeFromWire', () => {
  it('maps the failure of a failed outcome', () => {
    const failure = {
      kind: ERunFailureKind.Auth,
      message: 'no',
      providerId: 'openai',
    }
    const outcome = turnOutcomeFromWire({
      status: ETurnStatus.Failed,
      runId: toRunId('run-1'),
      message: 'no',
      failure,
    })
    expect(outcome).toMatchObject({ status: ETurnStatus.Failed, failure })
  })

  it('maps an unknown wire kind to Other instead of dropping the failure', () => {
    const outcome = turnOutcomeFromWire({
      status: ETurnStatus.Failed,
      runId: toRunId('run-1'),
      message: 'x',
      failure: { kind: 'from-the-future', message: 'x' },
    })
    expect(outcome).toMatchObject({ failure: { kind: ERunFailureKind.Other, message: 'x' } })
  })

  it('leaves failure absent for an older serve', () => {
    const outcome = turnOutcomeFromWire({
      status: ETurnStatus.Failed,
      runId: toRunId('run-1'),
      message: 'x',
    })
    expect('failure' in outcome).toBe(false)
  })

  it('keeps retryAt and resetAt through the Failed payload round-trip', () => {
    const failure = {
      kind: ERunFailureKind.Quota,
      message: 'out',
      retryAt: '2026-10-31T12:00:00.000Z',
      resetAt: '2026-11-01T00:00:00.000Z',
    }
    const wire = turnOutcomeWireSchema.parse(
      JSON.parse(
        JSON.stringify({ status: ETurnStatus.Failed, runId: 'run-1', message: 'out', failure }),
      ),
    )
    expect(turnOutcomeFromWire(wire)).toMatchObject({ status: ETurnStatus.Failed, failure })
  })

  it.each(['delivery', 'model-denied'])('keeps the %s kind through the Failed payload', (kind) => {
    const wire = turnOutcomeWireSchema.parse({
      status: ETurnStatus.Failed,
      runId: 'run-1',
      message: 'x',
      failure: { kind, message: 'x' },
    })
    expect(turnOutcomeFromWire(wire)).toMatchObject({ failure: { kind } })
  })

  it('parses an old failure payload without reset hints', () => {
    const wire = turnOutcomeWireSchema.parse({
      status: ETurnStatus.Failed,
      runId: 'run-1',
      message: 'x',
      failure: { kind: 'quota', message: 'x', statusCode: 402 },
    })
    const outcome = turnOutcomeFromWire(wire)
    expect(outcome).toMatchObject({ failure: { kind: ERunFailureKind.Quota, statusCode: 402 } })
    expect(outcome).not.toHaveProperty('failure.retryAt')
    expect(outcome).not.toHaveProperty('failure.resetAt')
  })

  it('maps a future kind to Other after a full wire parse', () => {
    const wire = turnOutcomeWireSchema.parse({
      status: ETurnStatus.Failed,
      runId: 'run-1',
      message: 'x',
      failure: { kind: 'from-the-future', message: 'x', retryAt: '2026-10-31T12:00:00.000Z' },
    })
    expect(turnOutcomeFromWire(wire)).toMatchObject({
      failure: { kind: ERunFailureKind.Other, retryAt: '2026-10-31T12:00:00.000Z' },
    })
  })
})

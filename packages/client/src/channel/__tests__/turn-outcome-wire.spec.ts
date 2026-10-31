import { describe, expect, it } from 'bun:test'

import { ERunFailureKind, toRunId } from '@dltech/atlas-core'

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
})

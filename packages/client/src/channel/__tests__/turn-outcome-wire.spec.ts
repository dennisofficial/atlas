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

  it('leaves failure absent for an older serve', () => {
    const outcome = turnOutcomeFromWire({
      status: ETurnStatus.Failed,
      runId: toRunId('run-1'),
      message: 'x',
    })
    expect('failure' in outcome).toBe(false)
  })
})

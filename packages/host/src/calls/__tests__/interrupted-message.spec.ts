import { describe, expect, it } from 'bun:test'

import { interruptedByRestartMessage } from '@dltech/atlas-core'
import { ECallFailure, ECallStatus } from '@dltech/atlas-protocol'

import { interruptedMessage } from '../errors'
import { interruptedResult } from '../remote-calls-frames'

describe('a call lost to a daemon restart', () => {
  it('reads the same whether the host or the daemon reports it', () => {
    const result = interruptedResult('exec')

    expect(result.status).toBe(ECallStatus.Failed)
    if (result.status === 'failed') {
      expect(result.error.code).toBe(ECallFailure.Interrupted)
      expect(result.error.message).toBe(interruptedMessage('exec'))
      expect(result.error.message).toBe(interruptedByRestartMessage('exec'))
    }
  })
})

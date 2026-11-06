import { describe, expect, it } from 'bun:test'

import { CallInterruptedError } from '@dltech/atlas-core'
import { ECallFailure, ECallStatus, type CallResult } from '@dltech/atlas-protocol'

import { valueFrom } from '../ports/results'

const failed = (code: ECallFailure): CallResult => ({
  status: ECallStatus.Failed,
  op: 'stat',
  error: { code, message: 'stat was interrupted' },
})

describe('valueFrom', () => {
  it('throws CallInterruptedError for an interrupted call, even inside a swallowing catch', async () => {
    const swallowed = await Promise.resolve()
      .then(() => valueFrom({ result: failed(ECallFailure.Interrupted), op: 'stat' }))
      .catch((error: unknown) => error)

    expect(swallowed).toBeInstanceOf(CallInterruptedError)
  })

  it('keeps throwing errno errors for other failures', () => {
    expect(() => valueFrom({ result: failed(ECallFailure.NotFound), op: 'stat' })).toThrow('ENOENT')
  })
})

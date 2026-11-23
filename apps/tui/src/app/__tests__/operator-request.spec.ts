import { describe, expect, test } from 'bun:test'

import { toCallId } from '@dltech/atlas-core'
import { mintEvents } from '@dltech/atlas-client/stream-fixture'

import { pendingOperatorRequestOf } from '../operator-request'

const callId = toCallId('call-1')

const parked = (): readonly unknown[] => [
  {
    type: 'tool-parked',
    callId,
    name: 'operator_input',
    request: { kind: 'input', prompt: 'paste the token' },
  },
]

describe('pendingOperatorRequestOf', () => {
  test('a parked operator_input is a pending request', () => {
    const events = mintEvents({ bodies: parked() as never })

    expect(pendingOperatorRequestOf({ events })).toEqual({
      callId: 'call-1',
      prompt: 'paste the token',
    })
  })

  test('a result for the same call clears it', () => {
    const events = mintEvents({
      bodies: [
        ...(parked() as never[]),
        { type: 'tool-result', callId, name: 'operator_input', output: { callId: 'call-1' } },
      ] as never,
    })

    expect(pendingOperatorRequestOf({ events })).toBeNull()
  })

  test('a parked tool that is not the operator is ignored', () => {
    const events = mintEvents({
      bodies: [
        {
          type: 'tool-parked',
          callId,
          name: 'something_else',
          request: { kind: 'input', prompt: 'not me' },
        },
      ] as never,
    })

    expect(pendingOperatorRequestOf({ events })).toBeNull()
  })
})

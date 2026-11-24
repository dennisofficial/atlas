import { describe, expect, it } from 'bun:test'

import { pendingOperatorRequestOf } from '../pending-request'
import { parkedOf, resultOf } from './fold-fixture'

describe('pendingOperatorRequestOf', () => {
  it('answers with the request that parked first, not the last', () => {
    const pending = pendingOperatorRequestOf({
      events: [parkedOf(2, { callId: 'call_2' }), parkedOf(1)],
    })

    expect(pending?.callId).toBe('call_1')
  })

  it('answers null once the only request settled', () => {
    const pending = pendingOperatorRequestOf({
      events: [
        parkedOf(1),
        resultOf(2, { output: { outcome: 'delivered', path: '/x', bytes: 4 } }),
      ],
    })

    expect(pending).toBeNull()
  })

  it('keeps the shell id of a shell request', () => {
    const pending = pendingOperatorRequestOf({
      events: [parkedOf(1, { request: { kind: 'shell', prompt: 'paste', shellId: 'shl_1' } })],
    })

    expect(pending).toMatchObject({ callId: 'call_1', shellId: 'shl_1', state: 'pending' })
  })
})

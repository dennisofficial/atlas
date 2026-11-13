import { EAuthor, EEntryKind } from '@dltech/atlas-client/transcript'
import { describe, expect, it } from 'bun:test'

import { operatorCoreSlots, operatorInputAskedSchema, operatorInputSettledSchema } from '../../core'
import { operatorRequestEntries, requestEntriesAt } from '../request-entry'
import { parkedOf, resultOf, stamp } from './fold-fixture'

const PATH = '/atlas/sessions/s1/requests/call_1'

const requestOf = (prompt = 'What is the login code?') => ({
  kind: 'input',
  prompt,
})

describe('the operator request fold', () => {
  it('draws a pending card keyed by the parked call id', () => {
    const [entry] = [...requestEntriesAt({ events: [parkedOf(1)] }).values()]

    expect(entry).toEqual({
      kind: EEntryKind.OperatorRequest,
      author: EAuthor.Model,
      key: 'call_1',
      text: 'asked the operator: What is the login code?',
      callId: 'call_1',
      prompt: 'What is the login code?',
      state: 'pending',
    })
  })

  it('carries the shell id of a shell request', () => {
    const [entry] = [
      ...requestEntriesAt({
        events: [parkedOf(1, { request: { kind: 'shell', prompt: 'paste', shellId: 'shl_1' } })],
      }).values(),
    ]

    expect(entry).toMatchObject({ shellId: 'shl_1', state: 'pending' })
  })

  it('reads the outcome off the closing tool-result', () => {
    const delivered = requestEntriesAt({
      events: [
        parkedOf(1),
        resultOf(2, { output: { outcome: 'delivered', path: PATH, bytes: 7 } }),
      ],
    }).get('call_1')
    const cancelled = requestEntriesAt({
      events: [
        parkedOf(1),
        resultOf(2, {
          output: { outcome: 'cancelled', reason: 'the operator cancelled the request' },
          error: { message: 'the operator did not deliver a value: cancelled' },
        }),
      ],
    }).get('call_1')

    expect(delivered).toMatchObject({ state: 'delivered', path: PATH, bytes: 7 })
    expect(cancelled).toMatchObject({
      state: 'cancelled',
      reason: 'the operator cancelled the request',
    })
  })

  it('reads an error with no parsable output as failed', () => {
    const [entry] = [
      ...requestEntriesAt({
        events: [parkedOf(1), resultOf(2, { error: { message: 'the shell was gone' } })],
      }).values(),
    ]

    expect(entry).toMatchObject({ state: 'failed', reason: 'the shell was gone' })
  })

  it('queues two parked calls and closes each on its own result', () => {
    const both = requestEntriesAt({
      events: [parkedOf(1), parkedOf(2, { callId: 'call_2' })],
    })
    const closed = requestEntriesAt({
      events: [
        parkedOf(1),
        parkedOf(2, { callId: 'call_2' }),
        resultOf(3, { callId: 'call_2', output: { outcome: 'delivered', path: PATH, bytes: 7 } }),
      ],
    })

    expect([...both.keys()]).toEqual(['call_1', 'call_2'])
    expect([...both.values()].map((entry) => entry.state)).toEqual(['pending', 'pending'])
    expect([...closed.values()].map((entry) => entry.state)).toEqual(['pending', 'delivered'])
  })

  it('draws no card for a legacy asked/settled pair', () => {
    const events = [
      stamp(1, {
        type: 'operator-input-asked',
        requestId: 'oreq_1',
        kind: 'input',
        prompt: 'the login code',
        expiresAt: '2026-11-12T12:00:00.000Z',
        secret: true,
        sessionId: 's1',
      }),
      stamp(2, {
        type: 'operator-input-settled',
        requestId: 'oreq_1',
        outcome: 'delivered',
        path: PATH,
        bytes: 7,
        sessionId: 's1',
      }),
    ]

    expect([...requestEntriesAt({ events }).values()]).toEqual([])
    expect([...operatorRequestEntries(events).values()]).toEqual([])
  })

  it('draws no card for a request-less tool-parked from before the request existed', () => {
    expect([
      ...requestEntriesAt({ events: [parkedOf(1, { request: undefined })] }).values(),
    ]).toEqual([])
  })

  it('draws no card for a parked call that is not an operator tool', () => {
    expect([
      ...requestEntriesAt({
        events: [parkedOf(1, { name: 'read', request: requestOf() })],
      }).values(),
    ]).toEqual([])
  })

  it('registers only the legacy event schemas, so nothing new is written', () => {
    expect(operatorCoreSlots.events).toHaveLength(2)
    expect(operatorCoreSlots.events[0]).toBe(operatorInputAskedSchema)
    expect(operatorCoreSlots.events[1]).toBe(operatorInputSettledSchema)
  })
})

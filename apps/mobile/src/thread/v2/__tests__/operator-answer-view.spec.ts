import { describe, expect, it } from 'bun:test'

import { toCallId } from '@dltech/atlas-core'
import { mintEvents } from '@dltech/atlas-client/stream-fixture'

import { EAnswerPhase, operatorAnswerViewOf } from '../operator-answer-view'

const parked = (
  args: { callId: string; prompt: string; shell?: boolean } = {
    callId: 'call_1',
    prompt: 'Paste the login code',
  },
) => ({
  type: 'tool-parked',
  callId: toCallId(args.callId),
  name: 'operator_input',
  request:
    args.shell === true
      ? { kind: 'shell', prompt: args.prompt, shellId: 'shl_1' }
      : { kind: 'input', prompt: args.prompt },
})

const eventsOf = (bodies: readonly unknown[]) => mintEvents({ bodies: bodies as never })

describe('operatorAnswerViewOf', () => {
  it('asks for nothing when no call is parked', () => {
    expect(operatorAnswerViewOf({ events: [], answer: null })).toEqual({
      request: null,
      sending: false,
      error: undefined,
    })
  })

  it('carries the earliest parked question', () => {
    const view = operatorAnswerViewOf({
      events: eventsOf([
        parked({ callId: 'call_1', prompt: 'first' }),
        parked({ callId: 'call_2', prompt: 'second' }),
      ]),
      answer: null,
    })

    expect(view.request).toEqual({ callId: 'call_1', prompt: 'first', shell: false })
    expect(view.sending).toBe(false)
  })

  it('marks a shell request as shell', () => {
    const view = operatorAnswerViewOf({
      events: eventsOf([parked({ callId: 'call_1', prompt: 'paste', shell: true })]),
      answer: null,
    })

    expect(view.request).toMatchObject({ shell: true })
  })

  it('stays sending while the answer is in flight and after it lands', () => {
    const events = eventsOf([parked()])

    expect(
      operatorAnswerViewOf({
        events,
        answer: { callId: 'call_1', phase: EAnswerPhase.Sending },
      }).sending,
    ).toBe(true)
    expect(
      operatorAnswerViewOf({ events, answer: { callId: 'call_1', phase: EAnswerPhase.Sent } })
        .sending,
    ).toBe(true)
  })

  it('carries the refusal of a failed answer for that call only', () => {
    const events = eventsOf([parked()])
    const failed = { callId: 'call_1', phase: EAnswerPhase.Failed, error: 'refused' }

    expect(operatorAnswerViewOf({ events, answer: failed }).error).toBe('refused')
    expect(
      operatorAnswerViewOf({ events, answer: { ...failed, callId: 'call_9' } }).error,
    ).toBeUndefined()
  })

  it('drops the request once the stream settles the call', () => {
    const view = operatorAnswerViewOf({
      events: eventsOf([
        parked(),
        {
          type: 'tool-result',
          callId: toCallId('call_1'),
          name: 'operator_input',
          output: { outcome: 'delivered', path: '/x', bytes: 4 },
        },
      ]),
      answer: null,
    })

    expect(view.request).toBeNull()
  })
})

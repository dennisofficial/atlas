import { describe, expect, it } from 'bun:test'

import type { AtlasStepMessage } from '@dltech/atlas-client/chat'
import { EStepEnd } from '@dltech/atlas-client/channel'
import { toEventId } from '@dltech/atlas-core'

import { eventsFromWire } from '../events-from-wire'
import { keptMessages } from '../kept-messages'

const message = (args: {
  id: string
  end: EStepEnd | null
  seq: number | null
}): AtlasStepMessage => ({
  id: args.id,
  role: 'assistant',
  parts: [{ type: 'text', text: 'hi', state: 'done' }],
  metadata: {
    stepId: args.id,
    end: args.end,
    supersededBy:
      args.seq === null ? null : { eventId: toEventId(`evt_${args.seq}`), seq: args.seq },
    errorMessage: null,
    callsAt: {},
  },
})

const assistantSaid = {
  id: 'evt_2',
  threadId: 'thr_1',
  seq: 2,
  runId: 'run_1',
  depth: 0,
  at: '2026-10-22T10:00:02.000Z',
  type: 'assistant-said',
  body: JSON.stringify({ type: 'assistant-said', parts: [{ type: 'text', text: 'hi' }] }),
}

describe('keptMessages', () => {
  it('returns the same array when every step is still live', () => {
    const messages = [message({ id: 'step_1', end: null, seq: null })]
    expect(keptMessages({ messages, events: [] })).toBe(messages)
  })

  it('drops a step once its durable event landed and keeps the open one', () => {
    const settled = message({ id: 'step_1', end: EStepEnd.Completed, seq: 2 })
    const open = message({ id: 'step_2', end: null, seq: null })

    const kept = keptMessages({
      messages: [settled, open],
      events: eventsFromWire([assistantSaid]),
    })

    expect(kept).toEqual([open])
  })
})

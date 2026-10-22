import { describe, expect, it } from 'bun:test'

import { toEventId, toRunId, toThreadId, type Event } from '@dltech/atlas-core'

import { createDeltaChannel } from '..'
import { firstStepId, recorder } from './signals'

const threadId = toThreadId('thread-1')

const assistantSaid = (args: { seq: number; text: string }): Event => ({
  type: 'assistant-said',
  parts: [{ type: 'text', text: args.text }],
  id: toEventId(`event-${args.seq}`),
  seq: args.seq,
  threadId,
  runId: toRunId('run-1'),
  depth: 0,
  at: '2026-08-24T00:00:00.000Z',
})

describe('an events-appended signal', () => {
  it('fires for an append made while the thread is idle', () => {
    const channel = createDeltaChannel()
    const { seen, listener } = recorder()
    channel.subscribe({ threadId, listener })

    channel.publisherFor({ threadId }).eventsAppended()

    expect(seen).toEqual([{ type: 'events-appended' }])
  })

  it('leaves the step in flight untouched, so an active stream keeps streaming', () => {
    const channel = createDeltaChannel()
    const { seen, listener } = recorder()
    channel.subscribe({ threadId, listener })
    const publisher = channel.publisherFor({ threadId })
    publisher.onChunk({ type: 'text-delta', id: 't1', text: 'auth' })
    const inFlight = channel.snapshot({ threadId })

    publisher.eventsAppended()

    expect(channel.snapshot({ threadId })).toBe(inFlight)
    expect(seen.at(-1)).toEqual({ type: 'events-appended' })
    expect(seen.some((signal) => signal.type === 'step-ended')).toBe(false)

    publisher.settleAppend({ events: [assistantSaid({ seq: 2, text: 'auth' })] })
    const ended = seen.at(-1)
    expect(ended?.type).toBe('step-ended')
    if (ended?.type === 'step-ended') expect(ended.stepId).toBe(firstStepId(seen))
  })

  it('does not open a step that never streamed', () => {
    const channel = createDeltaChannel()
    const { seen, listener } = recorder()
    channel.subscribe({ threadId, listener })

    channel.publisherFor({ threadId }).eventsAppended()

    expect(seen.map((signal) => signal.type)).toEqual(['events-appended'])
  })

  it('isolates a throwing listener: the next subscriber is still notified and the error is reported', () => {
    const channel = createDeltaChannel()
    const thrown = new Error('listener exploded')
    channel.subscribe({
      threadId,
      listener: () => {
        throw thrown
      },
    })
    const { seen, listener } = recorder()
    channel.subscribe({ threadId, listener })
    const reported: unknown[] = []

    channel.publisherFor({ threadId }).eventsAppended({
      onListenerError: (cause) => reported.push(cause),
    })

    expect(seen).toEqual([{ type: 'events-appended' }])
    expect(reported).toEqual([thrown])
  })

  it('delivers to every subscriber when nobody reports errors and nobody throws', () => {
    const channel = createDeltaChannel()
    const first = recorder()
    const second = recorder()
    channel.subscribe({ threadId, listener: first.listener })
    channel.subscribe({ threadId, listener: second.listener })

    channel.publisherFor({ threadId }).eventsAppended()

    expect(first.seen).toEqual([{ type: 'events-appended' }])
    expect(second.seen).toEqual([{ type: 'events-appended' }])
  })
})

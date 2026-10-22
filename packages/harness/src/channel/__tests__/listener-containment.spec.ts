import { describe, expect, it } from 'bun:test'

import { stampDrafts, toEventId, toRunId, toThreadId, type Event, type EventDraft, type EventLogPort } from '@dltech/atlas-core'

import { createDeltaChannel, EStepEnd, withDeltaPublishing, type ChannelListener } from '..'
import { recorder } from './signals'

const threadId = toThreadId('thread-1')
const runId = toRunId('run-1')

const exploding = (cause: Error): ChannelListener => () => {
  throw cause
}

function appendOnlyLog(): EventLogPort {
  const rows: Event[] = []
  return {
    async append({ threadId: target, runId: run, drafts }) {
      const envelopes = drafts.map((_: EventDraft, index: number) => ({
        id: toEventId(`event-${rows.length + index + 1}`),
        seq: rows.length + index + 1,
        threadId: target,
        runId: run,
        depth: 0,
        at: '2026-08-24T00:00:00.000Z',
      }))
      const stamped = stampDrafts({ drafts, envelopes })
      rows.push(...stamped)
      return stamped
    },
    async read() {
      return [...rows]
    },
    async refresh() {},
    async head() {
      return rows.length
    },
    async readOwn() {
      return [...rows]
    },
    async replace() {
      return []
    },
  }
}

describe('channel listener containment', () => {
  it('contains a throwing listener on every signal kind and keeps delivering to the others', () => {
    const reported: unknown[] = []
    const channel = createDeltaChannel({ onListenerError: (cause) => void reported.push(cause) })
    const boom = new Error('listener exploded')
    channel.subscribe({ threadId, listener: exploding(boom) })
    const { seen, listener } = recorder()
    channel.subscribe({ threadId, listener })
    const publisher = channel.publisherFor({ threadId })

    publisher.onChunk({ type: 'text-delta', id: 't1', text: 'hi' })
    publisher.turnWorking({ working: true })
    publisher.eventsAppended()
    publisher.operatorInput({ open: null })
    publisher.close({ end: EStepEnd.Completed })

    expect(seen.map((signal) => signal.type)).toEqual([
      'step-started',
      'chunk',
      'turn-working',
      'events-appended',
      'operator-input',
      'step-ended',
    ])
    expect(reported).toHaveLength(6)
    expect(reported.every((cause) => cause === boom)).toBe(true)
  })

  it('contains a listener that throws while replaying held signals and still subscribes the rest', () => {
    const reported: unknown[] = []
    const channel = createDeltaChannel({ onListenerError: (cause) => void reported.push(cause) })
    const publisher = channel.publisherFor({ threadId })
    publisher.turnWorking({ working: true })
    publisher.onChunk({ type: 'text-delta', id: 't1', text: 'hi' })
    const boom = new Error('replay exploded')

    const unsubscribe = channel.subscribe({ threadId, listener: exploding(boom) })
    const later = recorder()
    channel.subscribe({ threadId, listener: later.listener })
    publisher.eventsAppended()

    expect(reported.length).toBeGreaterThanOrEqual(3)
    expect(later.seen.map((signal) => signal.type)).toContain('events-appended')
    expect(typeof unsubscribe).toBe('function')
  })

  it('does not let a throwing error sink escape or stop later listeners', () => {
    const channel = createDeltaChannel({
      onListenerError: () => {
        throw new Error('log sink down')
      },
    })
    channel.subscribe({ threadId, listener: exploding(new Error('listener exploded')) })
    const { seen, listener } = recorder()
    channel.subscribe({ threadId, listener })

    expect(() => channel.publisherFor({ threadId }).eventsAppended()).not.toThrow()
    expect(seen).toEqual([{ type: 'events-appended' }])
  })

  it('prefers a per-call sink over the channel sink', () => {
    const channelSink: unknown[] = []
    const callSink: unknown[] = []
    const channel = createDeltaChannel({ onListenerError: (cause) => void channelSink.push(cause) })
    const boom = new Error('listener exploded')
    channel.subscribe({ threadId, listener: exploding(boom) })

    channel.publisherFor({ threadId }).eventsAppended({ onListenerError: (cause) => void callSink.push(cause) })
    channel.publisherFor({ threadId }).eventsAppended()

    expect(callSink).toEqual([boom])
    expect(channelSink).toEqual([boom])
  })

  it('contains throwing listeners without any sink configured', () => {
    const channel = createDeltaChannel()
    channel.subscribe({ threadId, listener: exploding(new Error('quiet failure')) })
    const { seen, listener } = recorder()
    channel.subscribe({ threadId, listener })

    expect(() => channel.publisherFor({ threadId }).eventsAppended()).not.toThrow()
    expect(seen).toHaveLength(1)
  })
})

describe('durable append never fails because of a subscriber', () => {
  it('returns the committed events when a listener throws while the step settles', async () => {
    const reported: unknown[] = []
    const channel = createDeltaChannel({ onListenerError: (cause) => void reported.push(cause) })
    const log = withDeltaPublishing({ log: appendOnlyLog(), channel })
    const boom = new Error('listener exploded')
    channel.subscribe({ threadId, listener: exploding(boom) })
    const { seen, listener } = recorder()
    channel.subscribe({ threadId, listener })
    channel.publisherFor({ threadId }).onChunk({ type: 'text-delta', id: 't1', text: 'auth' })

    const appended = await log.append({
      threadId,
      runId,
      drafts: [{ type: 'assistant-said', parts: [{ type: 'text', text: 'auth' }] }],
    })

    expect(appended).toHaveLength(1)
    expect(seen.some((signal) => signal.type === 'step-ended')).toBe(true)
    expect(reported).toContain(boom)
  })

  it('returns the committed events when no step is in flight and a listener throws', async () => {
    const channel = createDeltaChannel()
    const log = withDeltaPublishing({ log: appendOnlyLog(), channel })
    channel.subscribe({ threadId, listener: exploding(new Error('listener exploded')) })
    channel.publisherFor({ threadId }).turnWorking({ working: true })
    const { seen, listener } = recorder()
    channel.subscribe({ threadId, listener })

    const appended = await log.append({ threadId, runId, drafts: [{ type: 'user-said', text: 'what changed?' }] })

    expect(appended).toHaveLength(1)
    expect(seen.map((signal) => signal.type)).toContain('events-appended')
  })
})

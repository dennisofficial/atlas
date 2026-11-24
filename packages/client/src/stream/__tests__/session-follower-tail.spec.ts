import { describe, expect, it } from 'bun:test'
import type { V2Event } from '@dltech/atlas-core'
import type { StreamServerMessage } from '@dltech/atlas-protocol'

import { createSessionFollower } from '../session-follower'
import { memorySessionLog } from '../session-log'
import type { OlderEventsInput, OlderEventsPage, StreamTransport } from '../stream-ports'
import { createFakeScheduler, eventsMessage, settle } from './support'
import { tailLogOf } from './tail-support'

const setup = (extra: { log?: ReturnType<typeof memorySessionLog> } = {}) => {
  const log = extra.log ?? memorySessionLog()
  const clock = createFakeScheduler()
  const resnaps: string[] = []
  const unsupported: string[] = []
  const fetchCalls: OlderEventsInput[] = []
  const { all, base, tail, full } = tailLogOf()
  const transport: StreamTransport = {
    follow: () => ({ close: () => {} }),
    list: () => ({ close: () => {} }),
    events: (input) => {
      fetchCalls.push(input)
      return Promise.resolve(pageFrom(all, input))
    },
  }
  const follower = createSessionFollower({
    sessionId: 'session-1',
    log,
    scheduler: clock.scheduler,
    onResnap: () => resnaps.push('resnap'),
    onTailUnsupported: () => unsupported.push('unsupported'),
    fetchOlder: (input) => {
      const events = transport.events
      if (events === undefined) return Promise.resolve({ events: [] })
      return events({ ...input, sessionId: 'session-1' })
    },
  })
  return { follower, clock, resnaps, unsupported, log, fetchCalls, all, base, tail, full }
}

const pageFrom = (all: readonly V2Event[], input: OlderEventsInput): OlderEventsPage => ({
  events: all
    .filter((event) => event.seq > input.afterSeq)
    .slice(0, input.limit)
    .map((event) => JSON.parse(JSON.stringify(event)) as unknown),
})

describe('the follower on a tail open', () => {
  it('applies the base and folds only the tail', async () => {
    const { follower, base, tail, full } = setup()
    follower.handleMessage(base)
    follower.handleMessage(eventsMessage({ id: 's1', events: tail, live: true }))
    const snapshot = follower.getSnapshot()
    expect(snapshot.events.map((event) => event.seq)).toEqual([
      21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
    ])
    expect(snapshot.pending).toEqual(full.pending)
    expect(snapshot.cursor?.seq).toBe(30)
    await settle()
  })

  it('saves no snapshot until the window reaches the folded head', async () => {
    const { follower, clock, log, base, tail } = setup()
    follower.handleMessage(base)
    await settle()
    expect(log.saveCount()).toBe(0)
    follower.handleMessage(eventsMessage({ id: 's1', events: tail.slice(0, 5), live: true }))
    await settle()
    expect(log.saveCount()).toBe(0)
    follower.handleMessage(eventsMessage({ id: 's1', events: tail.slice(5), live: true }))
    clock.advance(1_000)
    await settle()
    expect(log.saveCount()).toBeGreaterThan(0)
  })

  it('asks the transport for the history the log does not hold', async () => {
    const { follower, base, tail, fetchCalls } = setup()
    follower.handleMessage(base)
    follower.handleMessage(eventsMessage({ id: 's1', events: tail, live: true }))
    expect(await follower.loadOlder()).toBe(14)
    expect(fetchCalls).toEqual([{ sessionId: 'session-1', afterSeq: 0, limit: 400 }])
    expect(follower.getSnapshot().events.map((event) => event.seq)).toEqual([
      1, 2, 3, 4, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
    ])
  })

  it('does not fetch when the log already holds the older page', async () => {
    const { follower, fetchCalls } = setup()
    follower.handleMessage(eventsMessage({ id: 's1', events: tailLogOf().all, live: true }))
    expect(await follower.loadOlder()).toBe(0)
    expect(fetchCalls).toHaveLength(0)
  })

  it('resets the window and asks for a replay when the base is unreadable', () => {
    const { follower, unsupported, base, tail } = setup()
    const broken = base as Extract<StreamServerMessage, { type: 'base' }>
    follower.handleMessage({
      ...broken,
      view: { ...broken.view, version: 1 },
    } as StreamServerMessage)
    expect(unsupported).toHaveLength(1)
    expect(follower.getSnapshot().events).toHaveLength(0)
    follower.handleMessage(eventsMessage({ id: 's1', events: tail, live: true }))
    expect(follower.getSnapshot().events.map((event) => event.seq)).toEqual([
      21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
    ])
  })
})

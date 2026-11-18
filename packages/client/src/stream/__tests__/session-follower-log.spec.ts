import { describe, expect, it } from 'bun:test'
import {
  EMPTY_PENDING,
  EMPTY_VISIBILITY,
  initialFailureMessage,
  initialSessionViewState,
  type V2Body,
  type V2Event,
} from '@dltech/atlas-core'
import { EStreamResetReason } from '@dltech/atlas-protocol'

import { memorySessionLog, SESSION_LOG_STRUCTURE_VERSION, type SessionLog } from '../session-log'
import { createSessionFollower, type SessionFollower } from '../session-follower'
import { applyPage, EMPTY_WINDOW, type SessionWindow } from '../session-window'
import {
  createFakeScheduler,
  eventsMessage,
  headOf,
  mintEvents,
  mintUserEvents,
  settle,
  userSaid,
} from './support'

const SESSION = 'session-1'

const posted = (inboxId: number): V2Body => ({
  type: 'input-posted',
  inboxId,
  kind: 'message',
  postedAt: '2026-11-05T10:00:00.000Z',
  text: `q${inboxId}`,
})

const seedEvents = async (args: { log: SessionLog; events: V2Event[] }) => {
  const window = applyPage({
    window: EMPTY_WINDOW,
    page: { events: args.events, head: headOf(args.events) },
  })
  await args.log.appendPage({ sessionId: SESSION, events: args.events, head: headOf(args.events) })
  return window
}

const seedSnapshot = async (args: { log: SessionLog; events: V2Event[]; throughSeq: number }) => {
  const window = await seedEvents({ log: args.log, events: args.events })
  await args.log.saveSnapshot({
    sessionId: SESSION,
    snapshot: {
      version: SESSION_LOG_STRUCTURE_VERSION,
      cursor: window.cursor,
      visibility: window.visibility,
      pending: window.pending,
      view: window.view,
      failureMessage: window.failureMessage,
      commandLog: window.commandLog,
      throughSeq: args.throughSeq,
    },
  })
  return window
}

const setup = (log: SessionLog = memorySessionLog()) => {
  const clock = createFakeScheduler()
  const follower: SessionFollower = createSessionFollower({
    sessionId: SESSION,
    log,
    scheduler: clock.scheduler,
    onResnap: () => undefined,
  })
  return { follower, clock, log }
}

const seqsOf = (window: SessionWindow | SessionFollower): number[] =>
  (window instanceof Object && 'getSnapshot' in window
    ? window.getSnapshot().events
    : window.events
  ).map((event) => event.seq)

describe('the session follower over the local log', () => {
  it('paints the stored tail and resumes at the stored cursor', async () => {
    const log = memorySessionLog()
    const events = mintUserEvents({ count: 3 })
    await seedSnapshot({ log, events, throughSeq: 3 })
    const { follower } = setup(log)

    await follower.hydrated

    expect(seqsOf(follower)).toEqual([1, 2, 3])
    expect(follower.cursor()).toEqual(headOf(events))
    expect(follower.getSnapshot().fromCache).toBe(true)
  })

  it('folds the events appended after the saved snapshot before painting', async () => {
    const log = memorySessionLog()
    const events = mintEvents({ bodies: [userSaid('a'), posted(7), userSaid('c')] })
    await seedSnapshot({ log, events, throughSeq: 1 })
    const { follower } = setup(log)

    await follower.hydrated

    expect(follower.getSnapshot().pending.pending.map((entry) => entry.inboxId)).toEqual([7])
    expect(follower.cursor()).toEqual(headOf(events))
  })

  it('starts empty when the log holds no snapshot', async () => {
    const { follower } = setup()

    await follower.hydrated

    expect(follower.getSnapshot().events).toEqual([])
    expect(follower.getSnapshot().pending).toEqual(EMPTY_PENDING)
    expect(follower.cursor()).toBeUndefined()
    expect(follower.getSnapshot().fromCache).toBe(false)
  })

  it('appends every received page to the log', async () => {
    const { follower, log } = setup()
    await follower.hydrated
    const events = mintUserEvents({ count: 4 })

    follower.handleMessage(eventsMessage({ id: 's1', events: events.slice(0, 2), live: true }))
    follower.handleMessage(eventsMessage({ id: 's1', events: events.slice(2), live: true }))
    await settle()

    expect(
      (await log.readTail({ sessionId: SESSION, count: 10 })).map((event) => event.seq),
    ).toEqual([1, 2, 3, 4])
  })

  it('saves a snapshot through the cursor at most once a second', async () => {
    const { follower, log, clock } = setup()
    await follower.hydrated
    const events = mintUserEvents({ count: 3 })

    follower.handleMessage(eventsMessage({ id: 's1', events: events.slice(0, 1), live: true }))
    await settle()
    expect((await log.loadSnapshot(SESSION))?.throughSeq).toBe(1)

    follower.handleMessage(eventsMessage({ id: 's1', events: events.slice(1), live: true }))
    await settle()
    expect((await log.loadSnapshot(SESSION))?.throughSeq).toBe(1)

    clock.advance(1_000)
    await settle()
    expect((await log.loadSnapshot(SESSION))?.throughSeq).toBe(3)
  })

  it('deletes the cached session when the server resets the log', async () => {
    const log = memorySessionLog()
    const events = mintUserEvents({ count: 3 })
    await seedSnapshot({ log, events, throughSeq: 3 })
    const { follower } = setup(log)
    await follower.hydrated

    follower.handleMessage({
      type: 'reset',
      id: 's1',
      reason: EStreamResetReason.Fork,
      tailFrom: 0,
    })
    await settle()

    expect(follower.getSnapshot().events).toEqual([])
    expect(follower.cursor()).toBeUndefined()
    expect(await log.listSessions()).toEqual([])
  })

  it('pages older visible events out of the log on demand', async () => {
    const log = memorySessionLog()
    const events = mintUserEvents({ count: 30 })
    await seedSnapshot({ log, events, throughSeq: 30 })
    const clock = createFakeScheduler()
    const follower = createSessionFollower({
      sessionId: SESSION,
      log,
      scheduler: clock.scheduler,
      onResnap: () => undefined,
      renderLimit: 10,
    })
    await follower.hydrated
    expect(seqsOf(follower)).toEqual([21, 22, 23, 24, 25, 26, 27, 28, 29, 30])

    expect(await follower.loadOlder()).toBe(20)
    expect(seqsOf(follower)[0]).toBe(1)

    expect(await follower.loadOlder()).toBe(0)
  })

  it('returns nothing older before the first received page', async () => {
    const { follower } = setup()
    await follower.hydrated

    expect(await follower.loadOlder()).toBe(0)
  })

  it('evicts another session once and stores the page when the log runs out of room', async () => {
    const inner = memorySessionLog()
    let failures = 1
    const log: SessionLog = {
      ...inner,
      appendPage: async (args) => {
        if (failures > 0) {
          failures -= 1
          throw new Error('quota exceeded')
        }
        return inner.appendPage(args)
      },
    }
    await inner.saveSnapshot({
      sessionId: 'other',
      snapshot: {
        version: SESSION_LOG_STRUCTURE_VERSION,
        cursor: { seq: 1, hash: 'h' },
        visibility: EMPTY_VISIBILITY,
        pending: EMPTY_PENDING,
        view: initialSessionViewState,
        failureMessage: initialFailureMessage,
        commandLog: [],
        throughSeq: 1,
      },
    })
    const { follower } = setup(log)
    await follower.hydrated
    const events = mintUserEvents({ count: 2 })

    follower.handleMessage(eventsMessage({ id: 's1', events, live: true }))
    await settle()

    expect(await inner.listSessions()).toEqual([SESSION])
    expect(
      (await inner.readTail({ sessionId: SESSION, count: 10 })).map((event) => event.seq),
    ).toEqual([1, 2])
  })

  it('keeps streaming in memory when the log cannot recover room', async () => {
    const inner = memorySessionLog()
    const log: SessionLog = {
      ...inner,
      appendPage: () => Promise.reject(new Error('quota exceeded')),
      saveSnapshot: () => Promise.reject(new Error('quota exceeded')),
    }
    const { follower } = setup(log)
    await follower.hydrated
    const events = mintUserEvents({ count: 2 })

    follower.handleMessage(eventsMessage({ id: 's1', events, live: true }))
    await settle()

    expect(seqsOf(follower)).toEqual([1, 2])
    expect(await inner.listSessions()).toEqual([])
  })
})

import { describe, expect, it } from 'bun:test'
import {
  EMPTY_PENDING,
  EMPTY_VISIBILITY,
  initialFailureMessage,
  initialSessionViewState,
} from '@dltech/atlas-core'

import { logSnapshotOf } from '../session-log-record'
import { memorySessionLog, SESSION_LOG_STRUCTURE_VERSION } from '../session-log'
import { applyPage, EMPTY_WINDOW } from '../session-window'
import { headOf, mintUserEvents } from './support'

const snapshotAt = (args: { throughSeq: number; cursorSeq?: number | undefined }) => ({
  version: SESSION_LOG_STRUCTURE_VERSION,
  cursor: { seq: args.cursorSeq ?? args.throughSeq, hash: 'h' },
  visibility: EMPTY_VISIBILITY,
  pending: EMPTY_PENDING,
  view: initialSessionViewState,
  failureMessage: initialFailureMessage,
  durable: [],
  commandLog: [],
  throughSeq: args.throughSeq,
})

describe('the in-memory session log', () => {
  it('stores one row per event and reads ranges by seq', async () => {
    const log = memorySessionLog()
    const events = mintUserEvents({ count: 5 })
    await log.appendPage({ sessionId: 's1', events, head: headOf(events) })

    expect(
      (await log.readRange({ sessionId: 's1', fromSeq: 2, toSeq: 4 })).map((e) => e.seq),
    ).toEqual([2, 3, 4])
    expect((await log.readTail({ sessionId: 's1', count: 2 })).map((e) => e.seq)).toEqual([4, 5])
    expect((await log.readBefore({ sessionId: 's1', seq: 3, count: 2 })).map((e) => e.seq)).toEqual(
      [1, 2],
    )
  })

  it('keeps appending past the first page without rewriting', async () => {
    const log = memorySessionLog()
    const events = mintUserEvents({ count: 4 })
    await log.appendPage({ sessionId: 's1', events: events.slice(0, 2), head: headOf(events) })
    await log.appendPage({ sessionId: 's1', events: events.slice(2), head: headOf(events) })

    expect((await log.readTail({ sessionId: 's1', count: 10 })).map((e) => e.seq)).toEqual([
      1, 2, 3, 4,
    ])
  })

  it('round-trips a snapshot and forgets only the session it deletes', async () => {
    const log = memorySessionLog()
    await log.saveSnapshot({ sessionId: 's1', snapshot: snapshotAt({ throughSeq: 3 }) })
    await log.saveSnapshot({ sessionId: 's2', snapshot: snapshotAt({ throughSeq: 1 }) })

    expect(await log.loadSnapshot('s1')).toEqual(snapshotAt({ throughSeq: 3 }))
    expect(await log.listSessions()).toEqual(['s1', 's2'])

    await log.deleteSession('s1')

    expect(await log.loadSnapshot('s1')).toBeUndefined()
    expect(await log.listSessions()).toEqual(['s2'])
  })

  it('clears every session', async () => {
    const log = memorySessionLog()
    await log.saveSnapshot({ sessionId: 's1', snapshot: snapshotAt({ throughSeq: 1 }) })
    await log.clear()

    expect(await log.listSessions()).toEqual([])
  })
})

describe('reading a stored snapshot', () => {
  it('reads a snapshot of this structure version', () => {
    expect(logSnapshotOf(snapshotAt({ throughSeq: 2 }))).toEqual(snapshotAt({ throughSeq: 2 }))
  })

  it('reads a record of another structure version as nothing', () => {
    expect(logSnapshotOf({ ...snapshotAt({ throughSeq: 2 }), version: 1 })).toBeUndefined()
  })

  it('reads a malformed record as nothing', () => {
    expect(logSnapshotOf('garbage')).toBeUndefined()
    expect(
      logSnapshotOf({ ...snapshotAt({ throughSeq: 2 }), visibility: { spans: [{}] } }),
    ).toBeUndefined()
  })

  it('resumes at the stored head and folds only through the saved seq', () => {
    const row = {
      sessionId: 's1',
      snapshot: {
        ...snapshotAt({ throughSeq: 2 }),
        cursor: { seq: 2, hash: 'h2' },
      },
      head: { seq: 5, hash: 'h5' },
    }

    expect(logSnapshotOf(row)).toEqual({
      ...snapshotAt({ throughSeq: 2 }),
      cursor: { seq: 5, hash: 'h5' },
    })
  })
})

describe('a page folded into a window', () => {
  it('carries the pending queue of the events it folded', () => {
    const events = mintUserEvents({ count: 2 })
    const window = applyPage({
      window: EMPTY_WINDOW,
      page: { events, head: headOf(events) },
    })

    expect(window.pending).toEqual(EMPTY_PENDING)
    expect(window.cursor).toEqual(headOf(events))
  })
})

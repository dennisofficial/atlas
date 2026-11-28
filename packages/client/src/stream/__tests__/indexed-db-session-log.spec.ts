import { describe, expect, it, spyOn } from 'bun:test'
import {
  EMPTY_PENDING,
  EMPTY_VISIBILITY,
  initialFailureMessage,
  initialSessionViewState,
} from '@dltech/atlas-core'
import { IDBFactory, IDBKeyRange, IDBVersionChangeEvent } from 'fake-indexeddb'

import {
  createIndexedDbSessionLog,
  SESSION_LOG_DB,
  SESSION_LOG_EVENTS_STORE,
  SESSION_LOG_SNAPSHOTS_STORE,
} from '../indexed-db-session-log'
import type { IdbFactory, IdbKeyRangeFactory } from '../indexed-db-types'
import { SESSION_LOG_STRUCTURE_VERSION } from '../session-log'
import { headOf, mintUserEvents } from './support'

const setup = () => {
  const factory = new IDBFactory()
  const log = createIndexedDbSessionLog({
    factory: factory as unknown as IdbFactory,
    keyRanges: IDBKeyRange as unknown as IdbKeyRangeFactory,
  })
  return { log, factory }
}

const snapshotAt = (throughSeq: number) => ({
  version: SESSION_LOG_STRUCTURE_VERSION,
  cursor: { seq: throughSeq, hash: 'h' },
  visibility: EMPTY_VISIBILITY,
  pending: EMPTY_PENDING,
  view: initialSessionViewState,
  failureMessage: initialFailureMessage,
  durable: [],
  commandLog: [],
  throughSeq,
})

const putSnapshotRow = (args: {
  factory: IDBFactory
  sessionId: string
  row: unknown
}): Promise<void> =>
  new Promise((resolve, reject) => {
    const request = args.factory.open(SESSION_LOG_DB, SESSION_LOG_STRUCTURE_VERSION)
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction(SESSION_LOG_SNAPSHOTS_STORE, 'readwrite')
      tx.objectStore(SESSION_LOG_SNAPSHOTS_STORE).put({
        sessionId: args.sessionId,
        ...(args.row as object),
      })
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => reject(tx.error)
    }
    request.onerror = () => reject(request.error)
  })

describe('the indexeddb session log', () => {
  it('reuses one connection for concurrent reads and later writes', async () => {
    const { log, factory } = setup()
    const opens = spyOn(factory, 'open')
    await Promise.all([
      log.listSessions(),
      log.loadSnapshot('s1'),
      log.readTail({ sessionId: 's1', count: 2 }),
    ])
    await log.saveSnapshot({ sessionId: 's1', snapshot: snapshotAt(1) })
    expect(await log.loadSnapshot('s1')).toEqual(snapshotAt(1))
    expect(opens).toHaveBeenCalledTimes(1)
    opens.mockRestore()
  })

  it.each(['close', 'versionchange'])('reopens after a database %s event', async (kind) => {
    const { log, factory } = setup()
    const opens = spyOn(factory, 'open')
    await log.listSessions()
    const db = (opens.mock.results[0]?.value as ReturnType<IDBFactory['open']> | undefined)?.result
    if (db === undefined) throw new Error('no database opened')
    const closes = spyOn(db, 'close')
    if (kind === 'close') db.close()
    db.dispatchEvent(new IDBVersionChangeEvent(kind))
    await log.listSessions()
    expect(opens).toHaveBeenCalledTimes(2)
    if (kind === 'versionchange') expect(closes).toHaveBeenCalledTimes(1)
    closes.mockRestore()
    opens.mockRestore()
  })

  it('rejects a transaction failure without losing its open connection', async () => {
    const { log, factory } = setup()
    const opens = spyOn(factory, 'open')
    await log.listSessions()
    const db = (opens.mock.results[0]?.value as ReturnType<IDBFactory['open']> | undefined)?.result
    if (db === undefined) throw new Error('no database opened')
    const transaction = spyOn(db, 'transaction').mockImplementationOnce(() => {
      throw new Error('quota exceeded')
    })
    await expect(log.clear()).rejects.toThrow('quota exceeded')
    expect(await log.listSessions()).toEqual([])
    expect(opens).toHaveBeenCalledTimes(1)
    transaction.mockRestore()
    opens.mockRestore()
  })

  it('keeps every event of every page and reads them by seq', async () => {
    const { log } = setup()
    const events = mintUserEvents({ count: 5 })
    await log.appendPage({ sessionId: 's1', events: events.slice(0, 2), head: headOf(events) })
    await log.appendPage({ sessionId: 's1', events: events.slice(2), head: headOf(events) })
    await log.appendPage({
      sessionId: 's2',
      events: mintUserEvents({ count: 1 }),
      head: headOf(events),
    })

    expect(
      (await log.readRange({ sessionId: 's1', fromSeq: 2, toSeq: 4 })).map((e) => e.seq),
    ).toEqual([2, 3, 4])
    expect((await log.readTail({ sessionId: 's1', count: 2 })).map((e) => e.seq)).toEqual([4, 5])
    expect((await log.readBefore({ sessionId: 's1', seq: 3, count: 2 })).map((e) => e.seq)).toEqual(
      [1, 2],
    )
  })

  it('keeps head-only sessions indexed when no snapshot is saved yet', async () => {
    const { log } = setup()
    const events = mintUserEvents({ count: 3 })
    await log.appendPage({ sessionId: 's1', events, head: headOf(events) })

    expect(await log.loadSnapshot('s1')).toBeUndefined()
    expect(await log.listSessions()).toEqual(['s1'])
    expect(await log.readTail({ sessionId: 's1', count: 3 })).toEqual(events)
  })

  it('resumes at the appended head while folding only through the saved seq', async () => {
    const { log } = setup()
    const events = mintUserEvents({ count: 3 })
    await log.appendPage({ sessionId: 's1', events, head: headOf(events) })
    await log.saveSnapshot({ sessionId: 's1', snapshot: snapshotAt(1) })

    expect(await log.loadSnapshot('s1')).toEqual({ ...snapshotAt(1), cursor: headOf(events) })
  })

  it('reads a snapshot of another structure version as nothing and forgets it', async () => {
    const { log, factory } = setup()
    await log.readTail({ sessionId: 'nothing', count: 1 })
    await putSnapshotRow({
      factory,
      sessionId: 's1',
      row: { snapshot: { ...snapshotAt(1), version: 1 }, head: undefined },
    })

    expect(await log.loadSnapshot('s1')).toBeUndefined()
    expect(await log.listSessions()).toEqual([])
  })

  it('lists and deletes whole sessions', async () => {
    const { log } = setup()
    const events = mintUserEvents({ count: 2 })
    await log.appendPage({ sessionId: 's1', events, head: headOf(events) })
    await log.saveSnapshot({ sessionId: 's1', snapshot: snapshotAt(2) })
    await log.appendPage({ sessionId: 's2', events, head: headOf(events) })
    await log.saveSnapshot({ sessionId: 's2', snapshot: snapshotAt(2) })

    expect([...(await log.listSessions())].sort()).toEqual(['s1', 's2'])

    await log.deleteSession('s1')

    expect(await log.readTail({ sessionId: 's1', count: 10 })).toEqual([])
    expect(await log.loadSnapshot('s2')).not.toBeUndefined()

    await log.clear()
    expect(await log.listSessions()).toEqual([])
    expect(await log.readTail({ sessionId: 's2', count: 10 })).toEqual([])
  })

  it('reads as empty when the browser holds no IndexedDB', async () => {
    const log = createIndexedDbSessionLog({ factory: undefined })

    await log.appendPage({
      sessionId: 's1',
      events: mintUserEvents({ count: 1 }),
      head: { seq: 1, hash: 'h' },
    })
    expect(await log.loadSnapshot('s1')).toBeUndefined()
    expect(await log.listSessions()).toEqual([])
    expect(await log.readTail({ sessionId: 's1', count: 5 })).toEqual([])
  })

  it('rejects when the database refuses to open and retries the next call', async () => {
    let opens = 0
    const failing = {
      open: () => {
        opens += 1
        const request = {
          onsuccess: undefined,
          onerror: undefined,
          onupgradeneeded: undefined,
          onblocked: undefined,
          result: undefined,
          error: new Error('blocked'),
        }
        setTimeout(() => {
          if (typeof request.onerror === 'function') (request.onerror as () => void)()
        }, 0)
        return request
      },
    }
    const log = createIndexedDbSessionLog({ factory: failing as unknown as IdbFactory })

    await expect(log.clear()).rejects.toThrow('blocked')
    await expect(log.listSessions()).rejects.toThrow('blocked')
    expect(opens).toBe(2)
  })
})

it('names the events store separately from snapshots', () => {
  expect(SESSION_LOG_EVENTS_STORE).toBe('events')
  expect(SESSION_LOG_SNAPSHOTS_STORE).toBe('snapshots')
})

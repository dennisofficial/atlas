import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it } from 'bun:test'
import {
  seedEventRow,
  seedThreadRow,
  seedUsers,
  USER_A,
  USER_B,
} from '../../../../test/session-seed'
import { readThreadEventsSnapshot } from './thread-events-snapshot'
import { lockThread } from './thread-head'

describe('coherent own-row event snapshot', () => {
  useTestDatabase()
  beforeEach(async () => {
    await seedUsers(USER_A, USER_B)
    await seedThreadRow({ id: 'thr_1', head: 3, historyRev: 2 })
    for (const seq of [1, 2, 3, 4]) await seedEventRow({ threadId: 'thr_1', seq })
  })

  it('bounds rows to the same locked head and returns its epoch', async () => {
    const snapshot = await readThreadEventsSnapshot({ userId: USER_A, threadId: 'thr_1' })
    expect(snapshot.head).toBe(3)
    expect(snapshot.historyRev).toBe(2)
    expect(snapshot.events.map((event) => event.seq)).toEqual([1, 2, 3])
  })

  it('preserves #1597 inclusive bounds and supports state-only fresh opens', async () => {
    const suffix = await readThreadEventsSnapshot({ userId: USER_A, threadId: 'thr_1', fromSeq: 2 })
    expect(suffix.events.map((event) => event.seq)).toEqual([2, 3])
    const state = await readThreadEventsSnapshot({
      userId: USER_A,
      threadId: 'thr_1',
      stateOnly: true,
    })
    expect(state).toEqual({ events: [], head: 3, historyRev: 2 })
  })

  it('excludes inherited reference prefixes', async () => {
    await seedThreadRow({
      id: 'thr_child',
      head: 4,
      parentThreadId: 'thr_1',
      forkMode: 'reference',
      forkSeq: 3,
    })
    await seedEventRow({ threadId: 'thr_child', seq: 4 })
    const snapshot = await readThreadEventsSnapshot({ userId: USER_A, threadId: 'thr_child' })
    expect(snapshot.events.map((event) => event.threadId)).toEqual(['thr_child'])
    expect(snapshot.events.map((event) => event.seq)).toEqual([4])
  })

  it('rejects cross-owner and nonexistent snapshots', async () => {
    await expect(
      readThreadEventsSnapshot({ userId: USER_B, threadId: 'thr_1' }),
    ).rejects.toBeInstanceOf(NotFoundException)
    await expect(
      readThreadEventsSnapshot({ userId: USER_A, threadId: 'missing' }),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('cannot read an epoch and rows from different sides of a locked rewrite', async () => {
    const locked = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const writer = db.transaction(async (tx) => {
      await lockThread({ tx, threadId: 'thr_1' })
      await tx.orm.public.Thread.where({ id: 'thr_1' }).update({ historyRev: 3 })
      locked.resolve()
      await release.promise
      await tx.orm.public.Event.where({ threadId: 'thr_1' })
        .where((event) => event.seq.lt(3))
        .deleteAll()
    })
    await locked.promise
    const reading = readThreadEventsSnapshot({ userId: USER_A, threadId: 'thr_1' })
    release.resolve()
    await writer
    const snapshot = await reading
    expect(snapshot.historyRev).toBe(3)
    expect(snapshot.head).toBe(3)
    expect(snapshot.events.map((event) => event.seq)).toEqual([3])
  })
})

import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { EThreadStreamFrame } from '@dltech/atlas-wire'
import { beforeEach, describe, expect, it } from 'bun:test'
import {
  eventsOf,
  seedThreadRow,
  seedUsers,
  threadById,
  USER_A,
} from '../../../../test/session-seed'
import { waitFor } from '../../../../test/fake-timers'
import { EventsService } from './events.service'
import { bumpHistoryRevision } from './history-revision'
import { lockThread } from './thread-head'
import { recordingSignals } from './thread-signals.fixture'
import { ThreadsHistoryService } from './threads-history.service'
import { ThreadsService } from './threads.service'

const target = { userId: USER_A, threadId: 'thr_history' }
const said = { type: 'user-said', body: '{}' }
const context = {
  type: 'context-loaded',
  body: '{}',
  contextSlot: 'file',
  contextKey: 'a',
  contextDigest: 'same',
}
const mark = { anchor: 'prefix', fromSeq: 1, throughSeq: 2, summary: 'summary' } as const
const append = (service: EventsService) =>
  service.append({
    ...target,
    draft: { runId: 'run_history', drafts: [said, said] },
  })

function gate() {
  let release = () => {}
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

describe('durable history epochs', () => {
  const testDb = useTestDatabase()

  beforeEach(async () => {
    await seedUsers(USER_A)
    await seedThreadRow({ id: target.threadId, userId: USER_A })
  })

  it('same-head replace publishes the new epoch after committing replacement rows', async () => {
    const { signals, framesOf } = recordingSignals()
    const service = new EventsService(signals)
    const original = await append(service)
    const frames = framesOf(target.threadId)
    const replacement = await service.replace({
      ...target,
      draft: { runId: 'new', drafts: [said, said] },
    })
    expect(await threadById(target.threadId)).toMatchObject({ head: 2, historyRev: 1 })
    expect(replacement.map((event) => event.id)).not.toEqual(original.map((event) => event.id))
    expect(frames).toEqual([
      { type: EThreadStreamFrame.Reset, head: 2, historyRev: 1 },
      { type: EThreadStreamFrame.Head, head: 2, historyRev: 1 },
    ])
  })

  it('summarising interior rows bumps epoch even with an unchanged head', async () => {
    const { signals, framesOf } = recordingSignals()
    await append(new EventsService(signals))
    const frames = framesOf(target.threadId)
    await new ThreadsHistoryService(signals).summarise({ ...target, draft: mark })
    expect(await threadById(target.threadId)).toMatchObject({ head: 2, historyRev: 1 })
    expect((await eventsOf(target.threadId)).map((event) => event.seq)).toEqual([2])
    expect(frames[0]).toEqual({ type: EThreadStreamFrame.Reset, head: 2, historyRev: 1 })
  })

  it('compact only appends a marker and keeps the epoch unchanged', async () => {
    const { signals, framesOf } = recordingSignals()
    await append(new EventsService(signals))
    const frames = framesOf(target.threadId)
    await new ThreadsHistoryService(signals).compact({ ...target, draft: mark })
    expect(await threadById(target.threadId)).toMatchObject({ head: 3, historyRev: 0 })
    expect(frames[0]).toMatchObject({
      type: EThreadStreamFrame.Events,
      fromSeq: 3,
      historyRev: 0,
      events: [expect.objectContaining({ seq: 3, type: 'history-compacted' })],
    })
  })

  it('rewind followed by regrowth to the same head retains the new epoch', async () => {
    const { signals, framesOf } = recordingSignals()
    const service = new EventsService(signals)
    await append(service)
    const frames = framesOf(target.threadId)
    await new ThreadsHistoryService(signals).rewind({ ...target, draft: { toSeq: 0 } })
    await append(service)
    expect(await threadById(target.threadId)).toMatchObject({ head: 2, historyRev: 1 })
    expect(frames[0]).toEqual({ type: EThreadStreamFrame.Reset, head: 0, historyRev: 1 })
    expect(frames[2]).toMatchObject({ type: EThreadStreamFrame.Events, historyRev: 1, fromSeq: 1 })
  })

  it('rolls the revision back with a failed mutation', async () => {
    await expect(
      db.transaction(async (tx) => {
        await bumpHistoryRevision({ tx, threadId: target.threadId })
        throw new Error('abort mutation')
      }),
    ).rejects.toThrow('abort mutation')
    expect(await threadById(target.threadId)).toMatchObject({ historyRev: 0, head: 0 })
  })

  it('does not bump epoch for metadata, model changes or copied and reference forks', async () => {
    const { signals } = recordingSignals()
    await append(new EventsService(signals))
    const threads = new ThreadsService(signals)
    await threads.rename({ ...target, draft: { title: 'renamed' } })
    await threads.chooseModel({ ...target, draft: { ref: 'model', effort: 'high' } })
    const history = new ThreadsHistoryService(signals)
    for (const mode of ['copy', 'reference'] as const) {
      const fork = await history.fork({ ...target, draft: { seq: 2, mode } })
      expect(await threadById(fork.id)).toMatchObject({ head: 2, historyRev: 0 })
    }
    expect(await threadById(target.threadId)).toMatchObject({ historyRev: 0 })
  })

  it('serialises simultaneous epoch increments without lost updates', async () => {
    const revisions = await Promise.all(
      Array.from({ length: 6 }, () =>
        db.transaction((tx) => bumpHistoryRevision({ tx, threadId: target.threadId })),
      ),
    )
    expect(revisions.sort()).toEqual([1, 2, 3, 4, 5, 6])
    expect(await threadById(target.threadId)).toMatchObject({ historyRev: 6 })
  })

  it('serialises concurrent context reuse before allocating or publishing rows', async () => {
    const { signals, framesOf } = recordingSignals()
    const service = new EventsService(signals)
    const frames = framesOf(target.threadId)
    const replies = await Promise.all(
      Array.from({ length: 5 }, () =>
        service.append({
          ...target,
          draft: { runId: 'run_shared', drafts: [context, context] },
        }),
      ),
    )
    expect(await eventsOf(target.threadId)).toHaveLength(1)
    expect(replies.flat().every((event) => event.id === replies[0]?.[0]?.id)).toBe(true)
    expect(frames.filter((frame) => frame.type === EThreadStreamFrame.Events)).toHaveLength(1)
    expect(await threadById(target.threadId)).toMatchObject({ head: 1, historyRev: 0 })
  })

  it('append waits for the destructive transaction and carries its committed epoch', async () => {
    const { signals, framesOf } = recordingSignals()
    const entered = gate()
    const release = gate()
    const mutation = db.transaction(async (tx) => {
      await bumpHistoryRevision({ tx, threadId: target.threadId })
      entered.release()
      await release.promise
    })
    await entered.promise
    const service = new EventsService(signals)
    const frames = framesOf(target.threadId)
    const pending = append(service)
    try {
      expect(await threadById(target.threadId)).toMatchObject({ historyRev: 0, head: 0 })
    } finally {
      release.release()
    }
    await Promise.all([mutation, pending])
    expect(frames[0]).toMatchObject({ type: EThreadStreamFrame.Events, historyRev: 1 })
  })

  it('replace cannot inspect or delete rows until the allocation lock is released', async () => {
    const { signals } = recordingSignals()
    const service = new EventsService(signals)
    await append(service)
    const entered = gate()
    const release = gate()
    const held = db.transaction(async (tx) => {
      await lockThread({ tx, threadId: target.threadId })
      entered.release()
      await release.promise
    })
    await entered.promise
    const pending = service.replace({ ...target, draft: { runId: 'new', drafts: [said] } })
    try {
      await waitFor(async () => {
        const waiting = await testDb().pool.query<{ query: string }>(
          `SELECT query FROM pg_stat_activity WHERE datname = current_database()
           AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`,
        )
        expect(waiting.rows.some((row) => row.query.includes('FOR UPDATE'))).toBe(true)
      })
      expect(await eventsOf(target.threadId)).toHaveLength(2)
      expect(await threadById(target.threadId)).toMatchObject({ historyRev: 0, head: 2 })
    } finally {
      release.release()
    }
    await Promise.all([held, pending])
    expect(await eventsOf(target.threadId)).toHaveLength(1)
    expect(await threadById(target.threadId)).toMatchObject({ historyRev: 1, head: 1 })
  })
})

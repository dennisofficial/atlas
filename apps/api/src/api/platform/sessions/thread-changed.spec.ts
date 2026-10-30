import { useTestDatabase } from '@dltech/atlas-db/testing'
import { db } from '@dltech/atlas-db'
import { beforeEach, describe, expect, it } from 'bun:test'
import { seedThreadRow, seedUsers, USER_A } from '../../../../test/session-seed'
import { DrainStateService } from '../health/drain-state.service'
import { InProcessThreadSignalBus, type ThreadChangedSignal } from './thread-signal.bus'
import { ThreadsService } from './threads.service'
import { ThreadSignalsService } from './thread-signals.service'

describe('threadChanged', () => {
  useTestDatabase()

  beforeEach(async () => {
    await seedUsers(USER_A)
    await seedThreadRow({ id: 'thr-1', userId: USER_A, title: 'first' })
  })

  const watching = () => {
    const signals = new ThreadSignalsService(
      new DrainStateService(),
      new InProcessThreadSignalBus(),
    )
    const seen: ThreadChangedSignal[] = []
    signals.watchThreadChanges({
      userId: USER_A,
      onChanged: (signal) => seen.push(signal),
    })
    return { signals, seen }
  }

  it('bumps rev and publishes the enriched thread to the owner', async () => {
    const { signals, seen } = watching()
    await signals.threadChanged({ threadId: 'thr-1' })
    expect(seen).toHaveLength(1)
    expect(seen[0]?.rev).toBe(1)
    expect(seen[0]?.userId).toBe(USER_A)
    expect(seen[0]?.thread.title).toBe('first')
  })

  it('keeps rev strictly monotonic under concurrent bumps', async () => {
    const { signals, seen } = watching()
    await Promise.all(Array.from({ length: 8 }, () => signals.threadChanged({ threadId: 'thr-1' })))
    const stored = await db.orm.public.Thread.where({ id: 'thr-1' }).all().firstOrThrow()
    expect(stored.rev).toBe(8)
    expect(seen.map((signal) => signal.rev).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('publishes nothing for an unknown thread', async () => {
    const { signals, seen } = watching()
    await signals.threadChanged({ threadId: 'missing' })
    expect(seen).toEqual([])
  })

  it('does not reach another user', async () => {
    const { signals } = watching()
    const other: ThreadChangedSignal[] = []
    signals.watchThreadChanges({
      userId: 'user-x',
      onChanged: (signal) => other.push(signal),
    })
    await signals.threadChanged({ threadId: 'thr-1' })
    expect(other).toEqual([])
  })

  it('is reached by headMoved, listChanged, podChanged, chooseModel and adopt', async () => {
    const { signals, seen } = watching()
    await signals.headMoved({ threadId: 'thr-1', head: 1 })
    await signals.listChanged({ userId: USER_A, threadId: 'thr-1' })
    await signals.podChanged({ threadId: 'thr-1' })
    const service = new ThreadsService(signals)
    await service.chooseModel({
      userId: USER_A,
      threadId: 'thr-1',
      draft: { ref: 'm', effort: 'low' },
    })
    await service.adopt({
      userId: USER_A,
      threadId: 'thr-1',
      draft: { workspace: '/w' },
    })
    expect(seen.map((signal) => signal.rev)).toEqual([1, 2, 3, 4, 5])
  })
})

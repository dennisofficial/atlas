import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import type { NotificationsService } from '../notifications/notifications.service'
import { seedThreadRow, seedUsers, USER_A, USER_B } from '../../../../test/session-seed'
import { recordingSignals } from './thread-signals.fixture'
import { nextReadSeq, ThreadReadService } from './thread-read.service'

const markerOf = async (userId: string) =>
  (await db.orm.public.ThreadRead.first({ userId, threadId: 'thr-1' }))?.seq

describe('nextReadSeq', () => {
  it('clamps the first marker to head', () => {
    expect(nextReadSeq({ existing: undefined, seq: 9, head: 5 })).toBe(5)
  })
  it('never moves backwards while the marker is within head', () => {
    expect(nextReadSeq({ existing: 4, seq: 2, head: 5 })).toBe(4)
  })
  it('rewinds a marker that sits beyond head', () => {
    expect(nextReadSeq({ existing: 8, seq: 3, head: 5 })).toBe(3)
  })
})

describe('ThreadReadService.markRead', () => {
  useTestDatabase()
  const recorder = recordingSignals()
  const dismissThread = vi.fn(async () => undefined)
  const service = new ThreadReadService(recorder.signals, {
    dismissThread,
  } as unknown as NotificationsService)

  beforeEach(async () => {
    await seedUsers(USER_A, USER_B)
    await seedThreadRow({ id: 'thr-1', userId: USER_A, head: 5 })
  })

  it('signals the thread change after marking read', async () => {
    const frames = recorder.changedThreads
    frames.length = 0

    await service.markRead({ userId: USER_A, threadId: 'thr-1', seq: 2 })

    expect(frames).toEqual(['thr-1'])
  })

  it('dismisses the thread notification when the marker advances', async () => {
    dismissThread.mockClear()

    await service.markRead({ userId: USER_A, threadId: 'thr-1', seq: 2 })

    expect(dismissThread).toHaveBeenCalledWith({ userId: USER_A, threadId: 'thr-1' })
  })

  it('does not dismiss when the marker does not move', async () => {
    await service.markRead({ userId: USER_A, threadId: 'thr-1', seq: 3 })
    dismissThread.mockClear()

    await service.markRead({ userId: USER_A, threadId: 'thr-1', seq: 3 })

    expect(dismissThread).not.toHaveBeenCalled()
  })

  it('does not signal when the stored marker does not move', async () => {
    await service.markRead({ userId: USER_A, threadId: 'thr-1', seq: 3 })
    const frames = recorder.changedThreads
    frames.length = 0

    await service.markRead({ userId: USER_A, threadId: 'thr-1', seq: 3 })
    await service.markRead({ userId: USER_A, threadId: 'thr-1', seq: 1 })

    expect(frames).toEqual([])
  })

  it('signals once when the marker advances', async () => {
    await service.markRead({ userId: USER_A, threadId: 'thr-1', seq: 3 })
    const frames = recorder.changedThreads
    frames.length = 0

    await service.markRead({ userId: USER_A, threadId: 'thr-1', seq: 4 })

    expect(frames).toEqual(['thr-1'])
  })

  it('is monotonic and clamped to head', async () => {
    await service.markRead({ userId: USER_A, threadId: 'thr-1', seq: 3 })
    await service.markRead({ userId: USER_A, threadId: 'thr-1', seq: 1 })
    expect(await markerOf(USER_A)).toBe(3)
    await service.markRead({ userId: USER_A, threadId: 'thr-1', seq: 99 })
    expect(await markerOf(USER_A)).toBe(5)
  })

  it('lets the marker drop after a rewind below it', async () => {
    await service.markRead({ userId: USER_A, threadId: 'thr-1', seq: 5 })
    await db.orm.public.Thread.where({ id: 'thr-1' }).update({ head: 2 })
    await service.markRead({ userId: USER_A, threadId: 'thr-1', seq: 4 })
    expect(await markerOf(USER_A)).toBe(2)
  })

  it('rejects a non-owner and writes nothing', async () => {
    await expect(service.markRead({ userId: USER_B, threadId: 'thr-1', seq: 2 })).rejects.toThrow(
      'thread not found',
    )
    expect(await markerOf(USER_B)).toBeUndefined()
  })
})

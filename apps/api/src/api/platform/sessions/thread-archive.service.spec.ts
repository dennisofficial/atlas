import { NotFoundException } from '@nestjs/common'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import type { AnyTask } from '@trigger.dev/sdk'
import { JobDispatcher, type JobDispatch } from '../../../_core/ports/job-dispatcher'
import {
  seedThreadRow,
  seedUsers,
  threadById,
  USER_A,
  USER_B,
  STAMP,
} from '../../../../test/session-seed'
import { THREAD_ARCHIVE_CLEANUP_TASK_ID } from './thread-archive-cleanup.contract'
import { ThreadArchiveService } from './thread-archive.service'

class FakeDispatcher extends JobDispatcher {
  readonly calls: JobDispatch<AnyTask>[] = []
  failure: Error | null = null

  async dispatch<TTask extends AnyTask>(args: JobDispatch<TTask>): Promise<{ runId: string }> {
    if (this.failure !== null) throw this.failure
    this.calls.push(args)
    return { runId: 'run_1' }
  }
}

describe('ThreadArchiveService', () => {
  useTestDatabase()
  let dispatcher: FakeDispatcher
  let service: ThreadArchiveService

  beforeEach(async () => {
    await seedUsers(USER_A, USER_B)
    await seedThreadRow({ id: 'thr_1' })
    dispatcher = new FakeDispatcher()
    service = new ThreadArchiveService(dispatcher)
  })

  it('archives without touching updatedAt and dispatches the cleanup once', async () => {
    await service.setArchived({ userId: USER_A, threadId: 'thr_1', archived: true })

    const row = await threadById('thr_1')
    expect(row?.archivedAt).toBeInstanceOf(Date)
    expect(row?.updatedAt.getTime()).toBe(STAMP.getTime())
    const archivedAt = row?.archivedAt?.toISOString() ?? ''
    expect(dispatcher.calls).toHaveLength(1)
    expect(dispatcher.calls[0]).toMatchObject({
      task: { id: THREAD_ARCHIVE_CLEANUP_TASK_ID },
      payload: { threadId: 'thr_1', archivedAt },
      idempotencyKey: `thread-archive-cleanup:thr_1:${archivedAt}`,
    })
  })

  it('unarchives by clearing archivedAt and dispatches nothing', async () => {
    await seedThreadRow({ id: 'thr_2', archivedAt: STAMP })

    await service.setArchived({ userId: USER_A, threadId: 'thr_2', archived: false })

    const row = await threadById('thr_2')
    expect(row?.archivedAt).toBeNull()
    expect(row?.updatedAt.getTime()).toBe(STAMP.getTime())
    expect(dispatcher.calls).toHaveLength(0)
  })

  it('answers not found for another user thread and leaves it untouched', async () => {
    await expect(
      service.setArchived({ userId: USER_B, threadId: 'thr_1', archived: true }),
    ).rejects.toBeInstanceOf(NotFoundException)

    expect((await threadById('thr_1'))?.archivedAt).toBeNull()
    expect(dispatcher.calls).toHaveLength(0)
  })

  it('keeps the thread archived when the dispatch fails', async () => {
    dispatcher.failure = new Error('trigger is down')

    await service.setArchived({ userId: USER_A, threadId: 'thr_1', archived: true })

    expect((await threadById('thr_1'))?.archivedAt).toBeInstanceOf(Date)
  })
})

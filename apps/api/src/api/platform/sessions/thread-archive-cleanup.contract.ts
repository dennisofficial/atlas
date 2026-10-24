import { z } from 'zod'
import type { Task, TaskContract } from '../../../_core/ports/job-dispatcher'

export const THREAD_ARCHIVE_CLEANUP_TASK_ID = 'thread-archive-cleanup'

export const threadArchiveCleanupPayloadSchema = z.object({
  threadId: z.string().min(1),
  archivedAt: z.iso.datetime(),
})

export type ThreadArchiveCleanupPayload = z.infer<typeof threadArchiveCleanupPayloadSchema>

export enum EThreadArchiveCleanupOutcome {
  Parked = 'parked',
  AlreadyParked = 'already-parked',
  NoSandbox = 'no-sandbox',
  Superseded = 'superseded',
}

export type ThreadArchiveCleanupOutput = { outcome: EThreadArchiveCleanupOutcome }

export type ThreadArchiveCleanupTask = Task<
  typeof THREAD_ARCHIVE_CLEANUP_TASK_ID,
  ThreadArchiveCleanupPayload,
  ThreadArchiveCleanupOutput
>

export const threadArchiveCleanupTaskContract: TaskContract<ThreadArchiveCleanupTask> = {
  id: THREAD_ARCHIVE_CLEANUP_TASK_ID,
  schema: threadArchiveCleanupPayloadSchema,
}

export const threadArchiveCleanupIdempotencyKey = (payload: ThreadArchiveCleanupPayload): string =>
  `thread-archive-cleanup:${payload.threadId}:${payload.archivedAt}`

import { schemaTask } from '@trigger.dev/sdk'
import { runThreadArchiveCleanup } from '../../api/platform/sessions/thread-archive-cleanup-run'
import {
  THREAD_ARCHIVE_CLEANUP_TASK_ID,
  threadArchiveCleanupPayloadSchema,
  type ThreadArchiveCleanupOutput,
  type ThreadArchiveCleanupPayload,
  type ThreadArchiveCleanupTask,
} from '../../api/platform/sessions/thread-archive-cleanup.contract'
import { workerThreadArchiveCleanupDeps } from './thread-archive-cleanup-graph'

export async function runThreadArchiveCleanupTask(
  payload: ThreadArchiveCleanupPayload,
): Promise<ThreadArchiveCleanupOutput> {
  return runThreadArchiveCleanup({ payload, deps: workerThreadArchiveCleanupDeps() })
}

export const threadArchiveCleanupTask = schemaTask({
  id: THREAD_ARCHIVE_CLEANUP_TASK_ID,
  schema: threadArchiveCleanupPayloadSchema,
  retry: { maxAttempts: 3 },
  maxDuration: 120,
  run: runThreadArchiveCleanupTask,
}) satisfies ThreadArchiveCleanupTask

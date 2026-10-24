import { db } from '@dltech/atlas-db'
import type { SandboxesService } from '../sandboxes/sandboxes.service'
import { parkedOf } from '../sandboxes/sandbox-lifecycle'
import {
  EThreadArchiveCleanupOutcome,
  type ThreadArchiveCleanupOutput,
  type ThreadArchiveCleanupPayload,
} from './thread-archive-cleanup.contract'

export const ARCHIVE_PARK_REASON = 'the thread was archived'

export type ThreadArchiveCleanupDeps = {
  park: SandboxesService['park']
}

export async function runThreadArchiveCleanup(args: {
  payload: ThreadArchiveCleanupPayload
  deps: ThreadArchiveCleanupDeps
}): Promise<ThreadArchiveCleanupOutput> {
  const { payload, deps } = args
  const thread = await db.orm.public.Thread.where({ id: payload.threadId })
    .select('id', 'archivedAt')
    .first()
  if (thread === null || thread.archivedAt?.toISOString() !== payload.archivedAt) {
    return { outcome: EThreadArchiveCleanupOutcome.Superseded }
  }
  const row = await db.orm.public.CloudSandbox.first({ threadId: payload.threadId })
  if (row === null) return { outcome: EThreadArchiveCleanupOutcome.NoSandbox }
  if (parkedOf(row)) return { outcome: EThreadArchiveCleanupOutcome.AlreadyParked }
  await deps.park({ row, reason: ARCHIVE_PARK_REASON })
  return { outcome: EThreadArchiveCleanupOutcome.Parked }
}

import { Logger } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { podSessionOf, sessionOfThread } from './session-of-thread'
import type { SandboxesService } from '../sandboxes/sandboxes.service'
import type { PreviewTunnelService } from '../sandboxes/preview-tunnel.service'
import { parkedOf } from '../sandboxes/sandbox-lifecycle'
import {
  EThreadArchiveCleanupOutcome,
  type ThreadArchiveCleanupOutput,
  type ThreadArchiveCleanupPayload,
} from './thread-archive-cleanup.contract'

const logger = new Logger('ThreadArchiveCleanup')

export const ARCHIVE_PARK_REASON = 'the thread was archived'

export type ThreadArchiveCleanupDeps = {
  park: SandboxesService['park']
  teardownPreviews: PreviewTunnelService['teardown']
}

export async function runThreadArchiveCleanup(args: {
  payload: ThreadArchiveCleanupPayload
  deps: ThreadArchiveCleanupDeps
}): Promise<ThreadArchiveCleanupOutput> {
  const { payload, deps } = args
  const session = await sessionOfThread({ reader: db, threadId: payload.threadId }).catch(
    () => null,
  )
  if (session === null || session.archivedAt?.toISOString() !== payload.archivedAt) {
    return { outcome: EThreadArchiveCleanupOutcome.Superseded }
  }
  const teardownFailure = await deps
    .teardownPreviews({ threadId: payload.threadId })
    .then(() => undefined)
    .catch((failure: unknown) => {
      logger.error(`preview teardown failed for thread ${payload.threadId}`, failure)
      return { failure }
    })
  const output = await parkSandbox({ threadId: payload.threadId, deps })
  if (teardownFailure !== undefined) throw teardownFailure.failure
  return output
}

async function parkSandbox(args: {
  threadId: string
  deps: ThreadArchiveCleanupDeps
}): Promise<ThreadArchiveCleanupOutput> {
  const sessionId = await podSessionOf({ reader: db, threadId: args.threadId })
  const row = await db.orm.public.CloudSandbox.first({ sessionId })
  if (row === null) return { outcome: EThreadArchiveCleanupOutcome.NoSandbox }
  if (parkedOf(row)) return { outcome: EThreadArchiveCleanupOutcome.AlreadyParked }
  await args.deps.park({ row, threadId: args.threadId, reason: ARCHIVE_PARK_REASON })
  return { outcome: EThreadArchiveCleanupOutcome.Parked }
}

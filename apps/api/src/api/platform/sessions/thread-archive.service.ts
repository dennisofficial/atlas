import { Inject, Injectable, Logger } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { JobDispatcher } from '../../../_core/ports/job-dispatcher'
import { sessionOfThread } from './session-of-thread'
import { ownedThread } from './ownership'
import { ThreadSignalsService } from './thread-signals.service'
import {
  threadArchiveCleanupIdempotencyKey,
  threadArchiveCleanupTaskContract,
  type ThreadArchiveCleanupPayload,
} from './thread-archive-cleanup.contract'

const failureText = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

@Injectable()
export class ThreadArchiveService {
  private readonly logger = new Logger(ThreadArchiveService.name)

  constructor(
    @Inject(JobDispatcher) private readonly dispatcher: JobDispatcher,
    private readonly signals: ThreadSignalsService,
  ) {}

  async setArchived(args: { userId: string; threadId: string; archived: boolean }): Promise<void> {
    const { userId, threadId, archived } = args
    await ownedThread({ reader: db, userId, threadId })
    const archivedAt = archived ? new Date() : null
    const session = await sessionOfThread({ reader: db, threadId })
    await db.orm.public.Session.where({ id: session.id }).update({ archivedAt })
    this.signals.threadChanged({ threadId })
    if (archivedAt === null) return
    await this.dispatchCleanup({ threadId, archivedAt: archivedAt.toISOString() })
  }

  private async dispatchCleanup(payload: ThreadArchiveCleanupPayload): Promise<void> {
    try {
      await this.dispatcher.dispatch({
        task: threadArchiveCleanupTaskContract,
        payload,
        idempotencyKey: threadArchiveCleanupIdempotencyKey(payload),
      })
    } catch (failure) {
      this.logger.warn(
        `dispatching thread-archive-cleanup for thread ${payload.threadId} failed: ${failureText(failure)}`,
      )
    }
  }
}

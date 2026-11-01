import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import { ESubscriptionActor, ESubscriptionEnd } from '@dltech/atlas-core'
import { db } from '@dltech/atlas-db'
import { PrSubscriptionLinks } from '../../../_core/ports/pr-subscription-links'
import { JobDispatcher } from '../../../_core/ports/job-dispatcher'
import { sessionOfThread } from './session-of-thread'
import { ownedThread } from './ownership'
import { appendStoredWithin, nextRunId } from './append'
import { threadsSubscriptions } from './thread-subscriptions'
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
    @Optional()
    @Inject(PrSubscriptionLinks)
    private readonly prLinks?: PrSubscriptionLinks,
  ) {}

  async setArchived(args: { userId: string; threadId: string; archived: boolean }): Promise<void> {
    const { userId, threadId, archived } = args
    await ownedThread({ reader: db, userId, threadId })
    const archivedAt = archived ? new Date() : null
    const session = await sessionOfThread({ reader: db, threadId })
    await db.orm.public.Session.where({ id: session.id }).update({ archivedAt })
    this.signals.threadChanged({ threadId })
    if (archivedAt === null) return
    await this.endSubscriptions({ userId, sessionId: session.id })
    await this.dispatchCleanup({ threadId, archivedAt: archivedAt.toISOString() })
  }

  /**
   * Archiving ends every conversation subscription the session holds: the harness restores them
   * from the log when the thread is unarchived, and the wake-link rows stop delivery at once.
   */
  private async endSubscriptions(args: { userId: string; sessionId: string }): Promise<void> {
    const threads = await db.orm.public.Thread.where({ sessionId: args.sessionId })
      .select('id')
      .all()
    const threadIds = threads.map((thread) => thread.id)
    if (threadIds.length === 0) return
    const byThread = await threadsSubscriptions({ reader: db, threadIds })
    const active = [...byThread.entries()].flatMap(([ownerThreadId, subscriptions]) =>
      subscriptions.map((subscription) => ({ ownerThreadId, subscription })),
    )
    for (const { ownerThreadId, subscription } of active) {
      await db.transaction((tx) =>
        appendStoredWithin({
          tx,
          threadId: ownerThreadId,
          userId: args.userId,
          runId: nextRunId(),
          drafts: [
            {
              type: 'subscription-ended',
              body: JSON.stringify({
                type: 'subscription-ended',
                subscriptionId: subscription.id,
                reason: ESubscriptionEnd.Archived,
                by: ESubscriptionActor.Clock,
              }),
            },
          ],
        }),
      )
      this.signals.threadChanged({ threadId: ownerThreadId })
    }
    if (this.prLinks === undefined) return
    await this.prLinks
      .endForThreads({ userId: args.userId, threadIds, activeTargets: new Map() })
      .catch((failure: unknown) => {
        this.logger.warn(
          `ending PR wake links for session ${args.sessionId} failed: ${failureText(failure)}`,
        )
      })
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

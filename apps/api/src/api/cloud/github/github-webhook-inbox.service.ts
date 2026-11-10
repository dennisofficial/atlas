import { Injectable, Logger } from '@nestjs/common'
import { db, or, type Row, type Tx } from '@dltech/atlas-db'
import { isGithubBudgetParked } from './github-request-budget'

const RECONCILE_BATCH = 32
export const MAX_ATTEMPTS = 10
export const INLINE_LEASE_MS = 5 * 60_000
export const RETRY_BASE_MS = 60_000
export const RETRY_CAP_MS = 60 * 60_000
export const PARK_RETRY_MS = 30_000
export const BUDGET_ERROR_MARKER = 'GitHub budget'
export const DEAD_RETENTION_MS = 7 * 24 * 60 * 60_000
export const PROCESSED_RETENTION_MS = 24 * 60 * 60_000

type InboxPayload = Row<'GithubWebhookInbox'>['payload']

export function retryDelayMs(attempts: number): number {
  return Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1))
}

/**
 * Durable webhook inbox. Every HMAC-verified delivery lands here before any processing, keyed by
 * GitHub's `x-github-delivery` id, so a redelivery after a crash between writes is a no-op instead
 * of a duplicate, and "did GitHub even send it?" is answerable from the database. Processing
 * failures are recorded on the row and answered 200 — GitHub must not retry-storm — and the
 * scheduled reconcile pass retries what never processed.
 *
 * `attempts` counts failures, never claims. A delivery the GitHub request budget refused was never
 * attempted against GitHub at all, so it parks and is retried shortly without being charged an
 * attempt; charging it walked whole bursts of deliveries into the dead letter and left their pull
 * requests permanently stale.
 */
@Injectable()
export class GithubWebhookInboxService {
  private readonly logger = new Logger(GithubWebhookInboxService.name)

  /** Returns false when the delivery id is already in the inbox; the caller answers 200. */
  async insert(args: { deliveryId: string; event: string; payload: unknown }): Promise<boolean> {
    const now = new Date()
    const inserted = await db.orm.public.GithubWebhookInbox.createAndCount(
      [
        {
          deliveryId: args.deliveryId,
          event: args.event,
          payload: (args.payload ?? null) as InboxPayload,
          receivedAt: now,
          attempts: 0,
          leaseUntil: new Date(now.getTime() + INLINE_LEASE_MS),
        },
      ],
      { onConflict: 'skip' },
    )
    return inserted > 0
  }

  async markProcessed(args: { deliveryId: string }): Promise<void> {
    await db.orm.public.GithubWebhookInbox.where({ deliveryId: args.deliveryId }).updateAndCount({
      processedAt: new Date(),
      processingError: null,
      leaseUntil: null,
      nextAttemptAt: null,
    })
  }

  async markFailed(args: { deliveryId: string; error: unknown }): Promise<void> {
    const row = await db.orm.public.GithubWebhookInbox.where({
      deliveryId: args.deliveryId,
    }).first()
    if (row === null) return
    const processingError = String(args.error).slice(0, 1000)
    const now = new Date()
    if (isGithubBudgetParked(args.error)) {
      await db.orm.public.GithubWebhookInbox.where({ deliveryId: args.deliveryId }).updateAndCount({
        processingError,
        leaseUntil: null,
        nextAttemptAt: new Date(now.getTime() + PARK_RETRY_MS),
      })
      return
    }
    const attempts = row.attempts + 1
    if (attempts >= MAX_ATTEMPTS) {
      await this.markDead({ row: { ...row, attempts }, processingError, now })
      return
    }
    await db.orm.public.GithubWebhookInbox.where({ deliveryId: args.deliveryId }).updateAndCount({
      attempts,
      processingError,
      leaseUntil: null,
      nextAttemptAt: new Date(now.getTime() + retryDelayMs(attempts)),
    })
  }

  async handleReconcile(args: {
    process: (entry: { event: string; payload: unknown }) => Promise<unknown>
  }): Promise<void> {
    const claimed = await this.claimDue()
    for (const row of claimed) {
      try {
        await args.process({ event: row.event, payload: row.payload })
      } catch (failure) {
        await this.markFailed({ deliveryId: row.deliveryId, error: failure })
        continue
      }
      await this.markProcessed({ deliveryId: row.deliveryId })
    }
  }

  /**
   * Deliveries that starved to death before parking existed get one more life: the budget has room
   * again now that covered repos are no longer timer-polled, and replaying them repairs the pull
   * requests they were carrying without a single REST read.
   */
  reviveStarved(args: { now: Date }): Promise<number> {
    return db.orm.public.GithubWebhookInbox.where((row) =>
      row.processingError.ilike(`%${BUDGET_ERROR_MARKER}%`),
    )
      .where((row) => row.deadAt.gte(new Date(args.now.getTime() - DEAD_RETENTION_MS)))
      .updateAndCount({ deadAt: null, attempts: 1, leaseUntil: null, nextAttemptAt: null })
  }

  prune(args: { now: Date }): Promise<number> {
    return db.orm.public.GithubWebhookInbox.where((row) =>
      or(
        row.processedAt.lt(new Date(args.now.getTime() - PROCESSED_RETENTION_MS)),
        row.deadAt.lt(new Date(args.now.getTime() - DEAD_RETENTION_MS)),
      ),
    ).deleteAndCount()
  }

  private async claimDue(): Promise<Row<'GithubWebhookInbox'>[]> {
    const now = new Date()
    return db.transaction(async (tx) => {
      const due = await tx.orm.public.GithubWebhookInbox.where({ processedAt: null, deadAt: null })
        .where((row) => or(row.leaseUntil.isNull(), row.leaseUntil.lt(now)))
        .where((row) => or(row.nextAttemptAt.isNull(), row.nextAttemptAt.lte(now)))
        .orderBy((row) => row.receivedAt.asc())
        .limit(RECONCILE_BATCH)
        .forUpdate({ skipLocked: true })
        .all()
      const claimed: Row<'GithubWebhookInbox'>[] = []
      for (const row of due) {
        if (row.attempts >= MAX_ATTEMPTS) {
          await this.markDead({
            row,
            processingError: row.processingError ?? 'lease expired without a recorded failure',
            now,
            tx,
          })
          continue
        }
        await tx.orm.public.GithubWebhookInbox.where({
          deliveryId: row.deliveryId,
        }).updateAndCount({
          leaseUntil: new Date(now.getTime() + INLINE_LEASE_MS),
        })
        claimed.push(row)
      }
      return claimed
    })
  }

  private async markDead(args: {
    row: Row<'GithubWebhookInbox'>
    processingError: string
    now: Date
    tx?: Tx
  }): Promise<void> {
    await (args.tx ?? db).orm.public.GithubWebhookInbox.where({
      deliveryId: args.row.deliveryId,
    }).updateAndCount({
      attempts: args.row.attempts,
      processingError: args.processingError,
      leaseUntil: null,
      nextAttemptAt: null,
      deadAt: args.now,
    })
    this.logger.error(
      `github webhook delivery ${args.row.deliveryId} event=${args.row.event} is dead after ${args.row.attempts} attempts: ${args.processingError}`,
    )
  }
}

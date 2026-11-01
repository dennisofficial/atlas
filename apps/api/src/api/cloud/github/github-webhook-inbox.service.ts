import { Injectable, Logger } from '@nestjs/common'
import { db, type Row, type Tx } from '@dltech/atlas-db'

const RECONCILE_BATCH = 32
const MAX_ATTEMPTS = 10

type InboxPayload = Row<'GithubWebhookInbox'>['payload']

/**
 * Durable webhook inbox. Every HMAC-verified delivery lands here before any processing, keyed by
 * GitHub's `x-github-delivery` id, so a redelivery after a crash between writes is a no-op instead
 * of a duplicate, and "did GitHub even send it?" is answerable from the database. Processing
 * failures are recorded on the row and answered 200 — GitHub must not retry-storm — and the
 * scheduled reconcile pass retries what never processed.
 */
@Injectable()
export class GithubWebhookInboxService {
  private readonly logger = new Logger(GithubWebhookInboxService.name)

  /** Returns false when the delivery id is already in the inbox; the caller answers 200. */
  async insert(args: { deliveryId: string; event: string; payload: unknown }): Promise<boolean> {
    return db.transaction(async (tx) => {
      const claimed = await this.claim({ tx, deliveryId: args.deliveryId })
      if (claimed !== undefined) return false
      await tx.orm.public.GithubWebhookInbox.create({
        deliveryId: args.deliveryId,
        event: args.event,
        payload: (args.payload ?? null) as InboxPayload,
        receivedAt: new Date(),
        attempts: 1,
      })
      return true
    })
  }

  async markProcessed(args: { deliveryId: string }): Promise<void> {
    await db.orm.public.GithubWebhookInbox.where({ deliveryId: args.deliveryId }).updateAndCount({
      processedAt: new Date(),
      processingError: null,
    })
  }

  async markFailed(args: { deliveryId: string; error: unknown }): Promise<void> {
    await db.orm.public.GithubWebhookInbox.where({ deliveryId: args.deliveryId }).updateAndCount({
      processingError: String(args.error).slice(0, 1000),
    })
  }

  async handleReconcile(args: {
    process: (entry: { event: string; payload: unknown }) => Promise<unknown>
  }): Promise<void> {
    const due = await db.orm.public.GithubWebhookInbox.where({ processedAt: null })
      .orderBy((row) => row.receivedAt.asc())
      .limit(RECONCILE_BATCH)
      .all()
    for (const row of due) {
      if (row.attempts >= MAX_ATTEMPTS) {
        this.logger.error(
          `github webhook ${row.deliveryId} event=${row.event} exceeded ${MAX_ATTEMPTS} attempts: ${row.processingError ?? 'no error recorded'}`,
        )
        continue
      }
      await db.transaction(async (tx) => {
        const claimed = await this.claim({ tx, deliveryId: row.deliveryId })
        if (claimed === undefined || claimed.processedAt !== null) return
        await tx.orm.public.GithubWebhookInbox.where({ deliveryId: row.deliveryId }).updateAndCount(
          {
            attempts: claimed.attempts + 1,
          },
        )
        try {
          await args.process({ event: claimed.event, payload: claimed.payload })
          await tx.orm.public.GithubWebhookInbox.where({
            deliveryId: row.deliveryId,
          }).updateAndCount({ processedAt: new Date(), processingError: null })
        } catch (failure) {
          await tx.orm.public.GithubWebhookInbox.where({
            deliveryId: row.deliveryId,
          }).updateAndCount({ processingError: String(failure).slice(0, 1000) })
        }
      })
    }
  }

  private async claim(args: {
    tx: Tx
    deliveryId: string
  }): Promise<Row<'GithubWebhookInbox'> | undefined> {
    const [row] = await args.tx.query(
      args.tx.sql.public.GithubWebhookInbox.select(
        'deliveryId',
        'event',
        'payload',
        'receivedAt',
        'processedAt',
        'processingError',
        'attempts',
      )
        .where((f, fns) => fns.eq(f.deliveryId, args.deliveryId))
        .forUpdate()
        .build(),
    )
    return row
  }
}

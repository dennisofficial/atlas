import { randomUUID } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { db, or, type Row, type Tx } from '@dltech/atlas-db'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import { GithubSandboxWakeService } from './github-sandbox-wake.service'
import { replayThreadEvents } from './github-pr-event-thread-replay'
import type { EPrEventKind, GithubPrEventDto, GithubPrEventPayload } from './github-realtime.types'

export const REPLAY_LEASE_MS = 5 * 60 * 1_000

/**
 * Durable per-user mailbox for PR events. Every event is one row per subscribing user, stamped
 * `deliveredAt` the moment a live stream actually pushes it; a reconnect replays the nulls and
 * marks them delivered. Rows are never reconstructed from GitHub — the mailbox is the record.
 */
@Injectable()
export class GithubPrEventMailboxService {
  constructor(
    private readonly fanout: GithubPrFanoutService,
    private readonly wake: GithubSandboxWakeService,
  ) {
    this.fanout.onEventDelivered(({ ackId, userStream, threadIds }) => {
      if (userStream) {
        void db.orm.public.GithubPrEvent.where({ id: ackId, deliveredAt: null })
          .updateAndCount({ deliveredAt: new Date() })
          .catch(() => undefined)
      }
      if (threadIds.length === 0) return
      const leaseExpiresAt = new Date(Date.now() + REPLAY_LEASE_MS)
      void db.orm.public.GithubPrEventDelivery.createAndCount(
        threadIds.map((threadId) => ({ eventId: ackId, threadId, leaseExpiresAt })),
        { onConflict: 'skip' },
      ).catch(() => undefined)
    })
  }

  async record(args: {
    userIds: readonly string[]
    repoFullName: string
    prNumber: number
    kind: EPrEventKind
    payload: GithubPrEventPayload
    dedupeKey?: string | undefined
    tx?: Tx | undefined
    wake?: boolean
  }): Promise<void> {
    const orm = args.tx === undefined ? db.orm : args.tx.orm
    for (const userId of args.userIds) {
      const dedupeKey = args.dedupeKey === undefined ? null : `${args.dedupeKey}:${userId}`
      const id = `evt_${randomUUID()}`
      const createdAt = new Date()
      const inserted = await orm.public.GithubPrEvent.createAndCount(
        [
          {
            id,
            userId,
            repoFullName: args.repoFullName,
            prNumber: args.prNumber,
            kind: args.kind,
            payload: args.payload,
            dedupeKey,
            deliveredAt: null,
            consumedAt: null,
            createdAt,
          },
        ],
        { onConflict: 'skip' },
      )
      if (inserted === 0) continue
      const row: Row<'GithubPrEvent'> = {
        id,
        userId,
        repoFullName: args.repoFullName,
        prNumber: args.prNumber,
        kind: args.kind,
        payload: args.payload,
        dedupeKey,
        deliveredAt: null,
        consumedAt: null,
        createdAt,
      }
      this.fanout.pushEvent({
        userIds: [userId],
        event: eventDtoOf(row),
        ackId: row.id,
      })
      if (args.wake === false) continue
      this.wake.notifyEvent(
        {
          userId,
          repoFullName: args.repoFullName,
          prNumber: args.prNumber,
        },
        {
          userId,
          repoFullName: args.repoFullName,
          prNumber: args.prNumber,
          kind: args.kind,
          payload: args.payload,
          eventId: row.id,
        },
      )
    }
  }

  /**
   * Replays rows the harness has not consumed: never delivered, or delivered longer ago than the
   * replay lease without a `consumedAt` ack. Delivered rows keep their original `deliveredAt`
   * (it is the user-stream marker); re-served rows are simply returned again.
   */
  async replayUndelivered(args: { userId: string }): Promise<GithubPrEventDto[]> {
    const leaseCutoff = new Date(Date.now() - REPLAY_LEASE_MS)
    const rows = await db.orm.public.GithubPrEvent.where({ userId: args.userId, consumedAt: null })
      .where((event) => or(event.deliveredAt.isNull(), event.deliveredAt.lt(leaseCutoff)))
      .orderBy((event) => event.createdAt.asc())
      .all()
    if (rows.length === 0) return []

    await db.orm.public.GithubPrEvent.where({ userId: args.userId, deliveredAt: null })
      .where((event) => event.id.in(rows.map((row) => row.id)))
      .updateAndCount({ deliveredAt: new Date() })
    return rows.map(eventDtoOf)
  }

  async replayForThread(args: { userId: string; threadId: string }): Promise<GithubPrEventDto[]> {
    return replayThreadEvents(args)
  }

  /**
   * The harness acks once an event is journaled into its thread's durable log: the per-thread
   * delivery row gains `ackedAt` (ending its replay lease) and the mailbox row `consumedAt`.
   */
  async acknowledge(args: { threadId: string; eventIds: readonly string[] }): Promise<number> {
    if (args.eventIds.length === 0) return 0
    const at = new Date()
    const acked = await db.orm.public.GithubPrEventDelivery.where({ threadId: args.threadId })
      .where((delivery) => delivery.eventId.in([...args.eventIds]))
      .where({ ackedAt: null })
      .updateAndCount({ ackedAt: at })
    if (acked === 0) return 0
    await db.orm.public.GithubPrEvent.where((event) =>
      event.id.in([...args.eventIds]),
    ).updateAndCount({ consumedAt: at })
    return acked
  }
}

export function eventDtoOf(row: Row<'GithubPrEvent'>): GithubPrEventDto {
  return {
    id: row.id,
    repoFullName: row.repoFullName,
    prNumber: row.prNumber,
    kind: row.kind as GithubPrEventDto['kind'],
    payload: row.payload as GithubPrEventPayload,
    createdAt: row.createdAt.toISOString(),
  }
}

import { Injectable } from '@nestjs/common'
import { db, type Row } from '@dltech/atlas-db'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import { GithubSandboxWakeService } from './github-sandbox-wake.service'
import { replayThreadEvents } from './github-pr-event-thread-replay'
import type { EPrEventKind, GithubPrEventDto, GithubPrEventPayload } from './github-realtime.types'

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
      void db.orm.public.GithubPrEventDelivery.createAndCount(
        threadIds.map((threadId) => ({ eventId: ackId, threadId })),
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
    wake?: boolean
  }): Promise<void> {
    for (const userId of args.userIds) {
      const row = await db.orm.public.GithubPrEvent.create({
        userId,
        repoFullName: args.repoFullName,
        prNumber: args.prNumber,
        kind: args.kind,
        payload: args.payload,
      })
      this.fanout.pushEvent({
        userIds: [userId],
        event: eventDtoOf(row),
        ackId: row.id,
      })
      if (args.wake === false) continue
      this.wake.notifyEvent({
        userId,
        repoFullName: args.repoFullName,
        prNumber: args.prNumber,
      })
    }
  }

  /**
   * Replays undelivered rows oldest-first and stamps them delivered. The update is scoped to
   * rows still null, so a second stream racing the replay does not deliver the same row twice.
   */
  async replayUndelivered(args: { userId: string }): Promise<GithubPrEventDto[]> {
    const rows = await db.orm.public.GithubPrEvent.where({ userId: args.userId, deliveredAt: null })
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

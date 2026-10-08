import { Injectable } from '@nestjs/common'
import { db, type GithubPrEventModel } from '../../../db'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import type {
  EPrEventKind,
  GithubPrEventDto,
  GithubPrEventPayload,
} from './github-realtime.types'

/**
 * Durable per-user mailbox for PR events. Every event is one row per subscribing user with
 * `deliveredAt` null until it was pushed to a live stream; a reconnect replays the nulls and
 * marks them delivered. Rows are never reconstructed from GitHub — the mailbox is the record.
 */
@Injectable()
export class GithubPrEventMailboxService {
  constructor(private readonly fanout: GithubPrFanoutService) {}

  async record(args: {
    userIds: readonly string[]
    repoFullName: string
    prNumber: number
    kind: EPrEventKind
    payload: GithubPrEventPayload
  }): Promise<void> {
    for (const userId of args.userIds) {
      const row = await db.githubPrEvent.create({
        data: {
          userId,
          repoFullName: args.repoFullName,
          prNumber: args.prNumber,
          kind: args.kind,
          payload: args.payload,
        },
      })
      this.fanout.pushEvent({ userIds: [userId], event: eventDtoOf(row) })
    }
  }

  /**
   * Replays undelivered rows oldest-first and stamps them delivered. The update is scoped to
   * rows still null, so a second stream racing the replay does not deliver the same row twice.
   */
  async replayUndelivered(args: { userId: string }): Promise<GithubPrEventDto[]> {
    const rows = await db.githubPrEvent.findMany({
      where: { userId: args.userId, deliveredAt: null },
      orderBy: { createdAt: 'asc' },
    })
    if (rows.length === 0) return []

    await db.githubPrEvent.updateMany({
      where: { userId: args.userId, deliveredAt: null, id: { in: rows.map((row) => row.id) } },
      data: { deliveredAt: new Date() },
    })
    return rows.map(eventDtoOf)
  }
}

export function eventDtoOf(row: GithubPrEventModel): GithubPrEventDto {
  return {
    id: row.id,
    repoFullName: row.repoFullName,
    prNumber: row.prNumber,
    kind: row.kind as GithubPrEventDto['kind'],
    payload: row.payload as GithubPrEventPayload,
    createdAt: row.createdAt.toISOString(),
  }
}

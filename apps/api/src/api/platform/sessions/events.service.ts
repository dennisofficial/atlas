import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { appendWithin, nextEventId, readComposedRows, readOwnRows } from './append'
import { ownedThread } from './ownership'
import { toEventDto } from './rows'
import type { AppendEventsDto, ReplaceEventsDto } from './sessions.dto'
import type { EventDto } from './sessions.types'

@Injectable()
export class EventsService {
  append(args: { userId: string; threadId: string; draft: AppendEventsDto }): Promise<EventDto[]> {
    return db.transaction((tx) =>
      appendWithin({
        tx,
        threadId: args.threadId,
        userId: args.userId,
        runId: args.draft.runId,
        parentRunId: args.draft.parentRunId,
        depth: args.draft.depth,
        drafts: args.draft.drafts,
      }),
    )
  }

  replace(args: {
    userId: string
    threadId: string
    draft: ReplaceEventsDto
  }): Promise<EventDto[]> {
    return db.transaction(async (tx) => {
      const thread = await tx.orm.public.Thread.where({ id: args.threadId }).first()
      if (thread === null) throw new NotFoundException('thread not found')
      if (thread.userId !== args.userId) {
        throw new ForbiddenException('thread belongs to another user')
      }

      await tx.orm.public.Event.where({ threadId: args.threadId }).deleteAndCount()

      const at = new Date()
      const rows = args.draft.drafts.map((draft, index) => ({
        id: nextEventId(),
        threadId: args.threadId,
        seq: index + 1,
        runId: args.draft.runId,
        parentRunId: null,
        depth: 0,
        at,
        type: draft.type,
        body: draft.body,
        contextSlot: draft.contextSlot ?? null,
        contextKey: draft.contextKey ?? null,
        contextDigest: draft.contextDigest ?? null,
        userId: args.userId,
      }))
      await tx.orm.public.Event.createAndCount(rows)

      await tx.orm.public.Thread.where({ id: args.threadId }).update({
        head: rows.length,
        updatedAt: at,
      })

      return rows.map(toEventDto)
    })
  }

  async read(args: {
    userId: string
    threadId: string
    upTo?: number | undefined
  }): Promise<EventDto[]> {
    await ownedThread({ reader: db, userId: args.userId, threadId: args.threadId })
    const rows = await readComposedRows({
      reader: db,
      threadId: args.threadId,
      userId: args.userId,
      upTo: args.upTo,
    })
    return rows.map(toEventDto)
  }

  async readOwn(args: {
    userId: string
    threadId: string
    upTo?: number | undefined
  }): Promise<EventDto[]> {
    await ownedThread({ reader: db, userId: args.userId, threadId: args.threadId })
    const rows = await readOwnRows({
      reader: db,
      threadId: args.threadId,
      userId: args.userId,
      upTo: args.upTo,
    })
    return rows.map(toEventDto)
  }

  async head(args: { userId: string; threadId: string }): Promise<{ head: number }> {
    const thread = await ownedThread({ reader: db, userId: args.userId, threadId: args.threadId })
    return { head: thread.head }
  }
}

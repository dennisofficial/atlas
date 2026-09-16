import { Injectable } from '@nestjs/common'
import { db } from '../../db'
import { appendWithin, readComposedRows, readOwnRows } from './append'
import { ownedThread } from './ownership'
import { toEventDto } from './rows'
import type { AppendEventsDto } from './sessions.dto'
import type { EventDto } from './sessions.types'

@Injectable()
export class EventsService {
  append(args: {
    userId: string
    threadId: string
    draft: AppendEventsDto
  }): Promise<EventDto[]> {
    return db.$transaction((tx) =>
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

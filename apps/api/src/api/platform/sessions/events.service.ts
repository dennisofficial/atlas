import { ForbiddenException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import type {
  AppendEventsInput,
  PodEvent,
  PodEventsReply,
  ReplaceEventsInput,
} from '@dltech/atlas-wire'
import { PrSubscriptionLinks } from '../../../_core/ports/pr-subscription-links'
import { applyPodEvents } from '../sandboxes/pod-events'
import { appendStoredWithin, nextEventId, readComposedRows, readOwnRows } from './append'
import { SUBSCRIPTION_EVENT_TYPES } from './thread-subscriptions'
import { bumpHistoryRevision } from './history-revision'
import { ownedThread } from './ownership'
import { ThreadSignalsService } from './thread-signals.service'
import { toEventDto } from './rows'
import type { EventDto } from './sessions.types'

@Injectable()
export class EventsService {
  constructor(
    private readonly signals: ThreadSignalsService,
    @Optional()
    @Inject(PrSubscriptionLinks)
    private readonly prLinks?: PrSubscriptionLinks,
  ) {}

  private async syncPrLinks(args: {
    userId: string
    threadId: string
    events: readonly EventDto[]
  }): Promise<void> {
    if (this.prLinks === undefined) return
    const rows = args.events.filter((event) => SUBSCRIPTION_EVENT_TYPES.includes(event.type))
    if (rows.length === 0) return
    await this.prLinks
      .syncFromEvents({ userId: args.userId, threadId: args.threadId, events: rows })
      .catch(() => undefined)
  }

  async append(args: {
    userId: string
    threadId: string
    draft: Omit<AppendEventsInput, 'threadId'>
  }): Promise<EventDto[]> {
    const { events, appended } = await db.transaction((tx) =>
      appendStoredWithin({
        tx,
        threadId: args.threadId,
        userId: args.userId,
        runId: args.draft.runId,
        parentRunId: args.draft.parentRunId,
        depth: args.draft.depth,
        drafts: args.draft.drafts,
      }),
    )
    if (appended !== undefined) {
      await this.signals.eventsAppended({ threadId: args.threadId, ...appended })
      await this.syncPrLinks({
        userId: args.userId,
        threadId: args.threadId,
        events: appended.events,
      })
    }
    return events
  }

  async replace(args: {
    userId: string
    threadId: string
    draft: Omit<ReplaceEventsInput, 'threadId'>
  }): Promise<EventDto[]> {
    const { events, historyRev } = await this.replaceWithin(args)
    await this.signals.eventsReset({ threadId: args.threadId, head: events.length, historyRev })
    return events
  }

  private replaceWithin(args: {
    userId: string
    threadId: string
    draft: Omit<ReplaceEventsInput, 'threadId'>
  }): Promise<{ events: EventDto[]; historyRev: number }> {
    return db.transaction(async (tx) => {
      const historyRev = await bumpHistoryRevision({ tx, threadId: args.threadId })
      const thread = await tx.orm.public.Thread.where({
        id: args.threadId,
      }).first()
      if (thread === null) throw new NotFoundException('thread not found')
      if (thread.userId !== args.userId) {
        throw new ForbiddenException('thread belongs to another user')
      }

      await tx.orm.public.Event.where({
        threadId: args.threadId,
      }).deleteAndCount()

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

      return { events: rows.map(toEventDto), historyRev }
    })
  }

  async read(args: {
    userId: string
    threadId: string
    fromSeq?: number | undefined
    upTo?: number | undefined
  }): Promise<EventDto[]> {
    await ownedThread({
      reader: db,
      userId: args.userId,
      threadId: args.threadId,
    })
    const rows = await readComposedRows({
      reader: db,
      threadId: args.threadId,
      userId: args.userId,
      fromSeq: args.fromSeq,
      upTo: args.upTo,
    })
    return rows.map(toEventDto)
  }

  async readOwn(args: {
    userId: string
    threadId: string
    fromSeq?: number | undefined
    upTo?: number | undefined
  }): Promise<EventDto[]> {
    await ownedThread({
      reader: db,
      userId: args.userId,
      threadId: args.threadId,
    })
    const rows = await readOwnRows({
      reader: db,
      threadId: args.threadId,
      userId: args.userId,
      fromSeq: args.fromSeq,
      upTo: args.upTo,
    })
    return rows.map(toEventDto)
  }

  async importEvents(args: {
    userId: string
    threadId: string
    events: readonly PodEvent[]
  }): Promise<PodEventsReply> {
    await ownedThread({
      reader: db,
      userId: args.userId,
      threadId: args.threadId,
    })
    return applyPodEvents({
      threadId: args.threadId,
      events: args.events,
      signals: this.signals,
    })
  }

  async head(args: { userId: string; threadId: string }): Promise<{ head: number }> {
    const thread = await ownedThread({
      reader: db,
      userId: args.userId,
      threadId: args.threadId,
    })
    return { head: thread.head }
  }
}

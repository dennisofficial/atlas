import { ConflictException } from '@nestjs/common'
import { POD_EVENT_CONFLICT_CODE, type PodEvent, type PodEventsReply } from '@dltech/atlas-wire'
import { db, type Row } from '@dltech/atlas-db'
import { nextEventId } from '../sessions/append'
import { bumpHistoryRevision } from '../sessions/history-revision'
import { toEventDto } from '../sessions/rows'
import { lockThread } from '../sessions/thread-head'
import { SUBSCRIPTION_EVENT_TYPES } from '../sessions/thread-subscriptions'
import type { ThreadSignalPublisher } from '../sessions/thread-signals.service'

const ASSISTANT_SAID = 'assistant-said'

const conflictAt = (seq: number): ConflictException =>
  new ConflictException({
    code: POD_EVENT_CONFLICT_CODE,
    seq,
    message: `seq ${seq} conflicts: the thread holds a different event there, the batch is not strictly increasing, or the seq sits below the head with no stored row`,
  })

const sameContent = (row: Row<'Event'>, event: PodEvent): boolean =>
  row.runId === event.runId &&
  row.parentRunId === (event.parentRunId ?? null) &&
  row.depth === event.depth &&
  row.type === event.type &&
  row.body === event.body &&
  row.contextSlot === (event.contextSlot ?? null) &&
  row.contextKey === (event.contextKey ?? null) &&
  row.contextDigest === (event.contextDigest ?? null)

export type PodPrLinks = {
  syncFromEvents(args: {
    userId: string
    threadId: string
    events: readonly { type: string; body: string }[]
  }): Promise<void>
}

export async function applyPodEvents(args: {
  threadId: string
  events: readonly PodEvent[]
  signals: ThreadSignalPublisher
  prLinks?: PodPrLinks | undefined
}): Promise<PodEventsReply & { assistantMoved: boolean }> {
  const { threadId, events } = args
  const { head, appended, assistantMoved, userId } = await db.transaction(async (tx) => {
    await lockThread({ tx, threadId })
    const thread = await tx.orm.public.Thread.where({ id: threadId }).all().firstOrThrow()
    const seqs = events.map((event) => event.seq)
    const stored = await tx.orm.public.Event.where({ threadId })
      .where((row) => row.seq.in(seqs))
      .all()
    const bySeq = new Map(stored.map((row) => [row.seq, row]))

    const fresh: PodEvent[] = []
    let previous = 0
    for (const event of events) {
      if (event.seq <= previous) throw conflictAt(event.seq)
      previous = event.seq
      const existing = bySeq.get(event.seq)
      if (existing !== undefined) {
        if (!sameContent(existing, event)) throw conflictAt(event.seq)
        continue
      }
      if (event.seq <= thread.head) throw conflictAt(event.seq)
      fresh.push(event)
    }

    if (fresh.length === 0)
      return { head: thread.head, assistantMoved: false, userId: thread.userId }
    const rows = fresh.map((event) => ({
      id: nextEventId(),
      threadId,
      seq: event.seq,
      runId: event.runId,
      parentRunId: event.parentRunId ?? null,
      depth: event.depth,
      at: new Date(event.at),
      type: event.type,
      body: event.body,
      contextSlot: event.contextSlot ?? null,
      contextKey: event.contextKey ?? null,
      contextDigest: event.contextDigest ?? null,
      userId: thread.userId,
    }))
    await tx.orm.public.Event.createAndCount(rows)
    const head = Math.max(thread.head, previous)
    const lastAssistantSeq = fresh
      .filter((event) => event.type === ASSISTANT_SAID)
      .reduce((max, event) => Math.max(max, event.seq), thread.lastAssistantSeq)
    await tx.orm.public.Thread.where({ id: threadId }).update({
      head,
      lastAssistantSeq,
      updatedAt: new Date(),
    })
    return {
      head,
      appended: { events: rows.map(toEventDto), head, historyRev: thread.historyRev },
      assistantMoved: lastAssistantSeq !== thread.lastAssistantSeq,
      userId: thread.userId,
    }
  })
  if (appended !== undefined) {
    await args.signals.eventsAppended({ threadId, ...appended })
    const linkRows = appended.events.filter((event) =>
      SUBSCRIPTION_EVENT_TYPES.includes(event.type),
    )
    if (linkRows.length > 0 && args.prLinks !== undefined) {
      await args.prLinks
        .syncFromEvents({ userId, threadId, events: linkRows })
        .catch(() => undefined)
    }
  }
  if (assistantMoved) args.signals.threadChanged({ threadId })
  return { head, assistantMoved }
}

export async function truncatePodEvents(args: {
  threadId: string
  toSeq: number
  signals: ThreadSignalPublisher
}): Promise<PodEventsReply & { assistantMoved: boolean }> {
  const { threadId, toSeq } = args
  const { head, historyRev, assistantMoved } = await db.transaction(async (tx) => {
    await lockThread({ tx, threadId })
    const thread = await tx.orm.public.Thread.where({ id: threadId }).all().firstOrThrow()
    const head = Math.min(thread.head, toSeq)
    const tail = tx.orm.public.Event.where({ threadId }).where((row) => row.seq.gt(toSeq))
    if (head === thread.head && (await tail.select('id').first()) === null) {
      return { head, assistantMoved: false }
    }
    const historyRev = await bumpHistoryRevision({ tx, threadId })
    await tail.deleteAndCount()
    const lastAssistantSeq = Math.min(thread.lastAssistantSeq, head)
    await tx.orm.public.Thread.where({ id: threadId }).update({
      head,
      lastAssistantSeq,
      updatedAt: new Date(),
    })
    return {
      head,
      historyRev,
      assistantMoved: lastAssistantSeq !== thread.lastAssistantSeq,
    }
  })
  if (historyRev !== undefined) await args.signals.eventsReset({ threadId, head, historyRev })
  if (assistantMoved) args.signals.threadChanged({ threadId })
  return { head, assistantMoved }
}

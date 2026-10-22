import { ConflictException } from '@nestjs/common'
import { POD_EVENT_CONFLICT_CODE, type PodEvent, type PodEventsReply } from '@dltech/atlas-wire'
import { db, type Row } from '@dltech/atlas-db'
import { nextEventId } from '../sessions/append'
import { lockThread } from '../sessions/thread-head'

const conflictAt = (seq: number): ConflictException =>
  new ConflictException({
    code: POD_EVENT_CONFLICT_CODE,
    seq,
    message: `the thread already holds a different event at seq ${seq}, or the flush skips ahead of its head`,
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

export function applyPodEvents(args: {
  threadId: string
  events: readonly PodEvent[]
}): Promise<PodEventsReply> {
  const { threadId, events } = args
  return db.transaction(async (tx) => {
    await lockThread({ tx, threadId })
    const thread = await tx.orm.public.Thread.where({ id: threadId }).all().firstOrThrow()
    const seqs = events.map((event) => event.seq)
    const stored = await tx.orm.public.Event.where({ threadId })
      .where((row) => row.seq.in(seqs))
      .all()
    const bySeq = new Map(stored.map((row) => [row.seq, row]))

    const fresh: PodEvent[] = []
    let next = thread.head + 1
    for (const event of events) {
      const existing = bySeq.get(event.seq)
      if (existing !== undefined) {
        if (!sameContent(existing, event)) throw conflictAt(event.seq)
        continue
      }
      if (event.seq !== next) throw conflictAt(event.seq)
      fresh.push(event)
      next += 1
    }

    if (fresh.length === 0) return { head: thread.head }
    await tx.orm.public.Event.createAndCount(
      fresh.map((event) => ({
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
      })),
    )
    const head = next - 1
    await tx.orm.public.Thread.where({ id: threadId }).update({ head, updatedAt: new Date() })
    return { head }
  })
}

export function truncatePodEvents(args: {
  threadId: string
  toSeq: number
}): Promise<PodEventsReply> {
  const { threadId, toSeq } = args
  return db.transaction(async (tx) => {
    await lockThread({ tx, threadId })
    const thread = await tx.orm.public.Thread.where({ id: threadId }).all().firstOrThrow()
    await tx.orm.public.Event.where({ threadId })
      .where((row) => row.seq.gt(toSeq))
      .deleteAndCount()
    const head = Math.min(thread.head, toSeq)
    if (head !== thread.head) {
      await tx.orm.public.Thread.where({ id: threadId }).update({ head, updatedAt: new Date() })
    }
    return { head }
  })
}

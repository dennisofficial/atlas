import { randomUUID } from 'node:crypto'
import { ForbiddenException } from '@nestjs/common'
import type { Row, Tx } from '@dltech/atlas-db'
import type { EventDraftInput } from '@dltech/atlas-wire'
import type { EventDto } from './sessions.types'
import { toEventDto } from './rows'
import { planSegments, type SessionReader } from './fork-chain'
import { createSessionWithMainThread } from './create-session'
import { advanceHead, lockThread } from './thread-head'

export const nextEventId = (): string => `evt_${randomUUID()}`
export const nextThreadId = (): string => `brn_${randomUUID()}`
export const nextSessionId = (): string => `ses_${randomUUID()}`
export const nextRunId = (): string => `run_${randomUUID()}`

type Identity = { slot: string; key: string; digest: string }

const identityOf = (draft: EventDraftInput): Identity | undefined => {
  const { contextSlot, contextKey, contextDigest } = draft
  if (contextSlot === undefined || contextKey === undefined || contextDigest === undefined) {
    return undefined
  }
  return { slot: contextSlot, key: contextKey, digest: contextDigest }
}

const identityKeyOf = (identity: Identity): string => `${identity.slot} ${identity.digest}`

const sameIdentity = (row: Row<'Event'>, identity: Identity): boolean =>
  row.contextSlot === identity.slot && row.contextDigest === identity.digest

async function claimThread(args: {
  tx: Tx
  threadId: string
  userId: string
  at: Date
}): Promise<void> {
  const existing = await args.tx.orm.public.Thread.where({ id: args.threadId })
    .select('userId')
    .first()
  if (existing !== null) {
    if (existing.userId !== args.userId) {
      throw new ForbiddenException('thread belongs to another user')
    }
    return
  }
  await createSessionWithMainThread({
    tx: args.tx,
    session: { id: nextSessionId(), userId: args.userId, createdAt: args.at, updatedAt: args.at },
    thread: {
      id: args.threadId,
      userId: args.userId,
      head: 0,
      createdAt: args.at,
      updatedAt: args.at,
    },
  })
}

async function loadReusable(args: {
  tx: Tx
  threadId: string
  userId: string
  drafts: readonly EventDraftInput[]
}): Promise<Map<string, EventDto>> {
  const wanted: Identity[] = []
  for (const draft of args.drafts) {
    const identity = identityOf(draft)
    if (identity !== undefined) wanted.push(identity)
  }
  if (wanted.length === 0) return new Map()

  const segments = await planSegments({ reader: args.tx, threadId: args.threadId })
  const reusable = new Map<string, EventDto>()
  for (const segment of segments) {
    const upTo = segment.upTo
    const scoped = args.tx.orm.public.Event.where({
      threadId: segment.threadId,
      userId: args.userId,
      type: 'context-loaded',
    })
    const rows = await (upTo === undefined ? scoped : scoped.where((event) => event.seq.lte(upTo)))
      .orderBy((event) => event.seq.asc())
      .all()
    for (const row of rows) {
      const identity = wanted.find((one) => sameIdentity(row, one))
      if (identity === undefined) continue
      reusable.set(identityKeyOf(identity), toEventDto(row))
    }
  }
  return reusable
}

type PlanEntry = { kind: 'reused'; event: EventDto } | { kind: 'fresh'; position: number }

function planAppend(args: {
  drafts: readonly EventDraftInput[]
  reusable: ReadonlyMap<string, EventDto>
}): { fresh: EventDraftInput[]; resolve: (stamped: readonly EventDto[]) => EventDto[] } {
  const entries: PlanEntry[] = []
  const fresh: EventDraftInput[] = []
  const claimed = new Map<string, number>()

  for (const draft of args.drafts) {
    const identity = identityOf(draft)
    if (identity === undefined) {
      entries.push({ kind: 'fresh', position: fresh.length })
      fresh.push(draft)
      continue
    }

    const identityKey = identityKeyOf(identity)
    const reused = args.reusable.get(identityKey)
    if (reused !== undefined) {
      entries.push({ kind: 'reused', event: reused })
      continue
    }

    const claimedPosition = claimed.get(identityKey)
    if (claimedPosition !== undefined) {
      entries.push({ kind: 'fresh', position: claimedPosition })
      continue
    }

    claimed.set(identityKey, fresh.length)
    entries.push({ kind: 'fresh', position: fresh.length })
    fresh.push(draft)
  }

  return {
    fresh,
    resolve: (stamped) =>
      entries.map((entry) => {
        if (entry.kind === 'reused') return entry.event
        const event = stamped[entry.position]
        if (event === undefined) {
          throw new Error(`append plan expected a stamped event at position ${entry.position}`)
        }
        return event
      }),
  }
}

export type StoredAppend = { events: EventDto[]; head: number; historyRev: number }

type AppendWithin = {
  tx: Tx
  threadId: string
  userId: string
  runId: string
  parentRunId?: string | undefined
  depth?: number | undefined
  drafts: readonly EventDraftInput[]
}

export async function appendWithin(args: AppendWithin): Promise<EventDto[]> {
  return (await appendStoredWithin(args)).events
}

export async function appendStoredWithin(
  args: AppendWithin,
): Promise<{ events: EventDto[]; appended?: StoredAppend }> {
  if (args.drafts.length === 0) return { events: [] }

  const at = new Date()
  await claimThread({ tx: args.tx, threadId: args.threadId, userId: args.userId, at })
  await lockThread({ tx: args.tx, threadId: args.threadId })

  const reusable = await loadReusable({
    tx: args.tx,
    threadId: args.threadId,
    userId: args.userId,
    drafts: args.drafts,
  })
  const plan = planAppend({ drafts: args.drafts, reusable })
  if (plan.fresh.length === 0) return { events: plan.resolve([]) }

  const head = await advanceHead({
    tx: args.tx,
    threadId: args.threadId,
    by: plan.fresh.length,
    at,
  })
  const firstSeq = head - plan.fresh.length + 1

  const rows = plan.fresh.map((draft, index) => ({
    id: nextEventId(),
    threadId: args.threadId,
    seq: firstSeq + index,
    runId: args.runId,
    parentRunId: args.parentRunId ?? null,
    depth: args.depth ?? 0,
    at,
    type: draft.type,
    body: draft.body,
    contextSlot: draft.contextSlot ?? null,
    contextKey: draft.contextKey ?? null,
    contextDigest: draft.contextDigest ?? null,
    userId: args.userId,
  }))
  await args.tx.orm.public.Event.createAndCount(rows)

  const stored = rows.map(toEventDto)
  const thread = await args.tx.orm.public.Thread.where({ id: args.threadId }).firstOrThrow()
  return {
    events: plan.resolve(stored),
    appended: { events: stored, head, historyRev: thread.historyRev },
  }
}

export async function readOwnRows(args: {
  reader: SessionReader
  threadId: string
  userId: string
  fromSeq?: number | undefined
  upTo?: number | undefined
  type?: string | undefined
}): Promise<Row<'Event'>[]> {
  const { fromSeq, upTo, type } = args
  let scoped = args.reader.orm.public.Event.where({
    threadId: args.threadId,
    userId: args.userId,
    ...(type === undefined ? {} : { type }),
  })
  if (fromSeq !== undefined) scoped = scoped.where((event) => event.seq.gte(fromSeq))
  if (upTo !== undefined) scoped = scoped.where((event) => event.seq.lte(upTo))
  return scoped.orderBy((event) => event.seq.asc()).all()
}

export async function readComposedRows(args: {
  reader: SessionReader
  threadId: string
  userId: string
  fromSeq?: number | undefined
  upTo?: number | undefined
  type?: string | undefined
}): Promise<Row<'Event'>[]> {
  const segments = await planSegments({
    reader: args.reader,
    threadId: args.threadId,
    fromSeq: args.fromSeq,
    upTo: args.upTo,
  })

  const composed: Row<'Event'>[] = []
  for (const segment of segments) {
    composed.push(
      ...(await readOwnRows({
        reader: args.reader,
        threadId: segment.threadId,
        userId: args.userId,
        fromSeq: segment.fromSeq,
        upTo: segment.upTo,
        ...(args.type === undefined ? {} : { type: args.type }),
      })),
    )
  }
  return composed
}

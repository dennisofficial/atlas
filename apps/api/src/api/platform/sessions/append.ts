import { randomUUID } from 'node:crypto'
import { ForbiddenException } from '@nestjs/common'
import type { EventModel } from '../../../db'
import type { Prisma } from '../../../generated/prisma/client'
import type { EventDraftDto } from './sessions.dto'
import type { EventDto } from './sessions.types'
import { toEventDto } from './rows'
import { planSegments, type SessionReader } from './fork-chain'

export const nextEventId = (): string => `evt_${randomUUID()}`
export const nextThreadId = (): string => `brn_${randomUUID()}`
export const nextRunId = (): string => `run_${randomUUID()}`

export const nowIso = (): string => new Date().toISOString()

type Tx = Prisma.TransactionClient

type Identity = { slot: string; key: string; digest: string }

const identityOf = (draft: EventDraftDto): Identity | undefined => {
  const { contextSlot, contextKey, contextDigest } = draft
  if (contextSlot === undefined || contextKey === undefined || contextDigest === undefined) {
    return undefined
  }
  return { slot: contextSlot, key: contextKey, digest: contextDigest }
}

const sameIdentity = (row: EventModel, identity: Identity): boolean =>
  row.contextSlot === identity.slot &&
  row.contextKey === identity.key &&
  row.contextDigest === identity.digest

async function claimThread(args: {
  tx: Tx
  threadId: string
  userId: string
  at: string
}): Promise<void> {
  const existing = await args.tx.thread.findUnique({
    where: { id: args.threadId },
    select: { userId: true },
  })
  if (existing !== null) {
    if (existing.userId !== args.userId) {
      throw new ForbiddenException('thread belongs to another user')
    }
    return
  }
  await args.tx.thread.create({
    data: {
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
  drafts: readonly EventDraftDto[]
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
    const rows = await args.tx.event.findMany({
      where: {
        threadId: segment.threadId,
        userId: args.userId,
        type: 'context-loaded',
        ...(segment.upTo === undefined ? {} : { seq: { lte: segment.upTo } }),
      },
      orderBy: { seq: 'asc' },
    })
    for (const row of rows) {
      const identity = wanted.find((one) => sameIdentity(row, one))
      if (identity === undefined) continue
      reusable.set(`${identity.slot}${identity.key}${identity.digest}`, toEventDto(row))
    }
  }
  return reusable
}

type PlanEntry = { kind: 'reused'; event: EventDto } | { kind: 'fresh'; position: number }

function planAppend(args: {
  drafts: readonly EventDraftDto[]
  reusable: ReadonlyMap<string, EventDto>
}): { fresh: EventDraftDto[]; resolve: (stamped: readonly EventDto[]) => EventDto[] } {
  const entries: PlanEntry[] = []
  const fresh: EventDraftDto[] = []
  const claimed = new Map<string, number>()

  for (const draft of args.drafts) {
    const identity = identityOf(draft)
    if (identity === undefined) {
      entries.push({ kind: 'fresh', position: fresh.length })
      fresh.push(draft)
      continue
    }

    const identityKey = `${identity.slot}${identity.key}${identity.digest}`
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

export async function appendWithin(args: {
  tx: Tx
  threadId: string
  userId: string
  runId: string
  parentRunId?: string | undefined
  depth?: number | undefined
  drafts: readonly EventDraftDto[]
}): Promise<EventDto[]> {
  if (args.drafts.length === 0) return []

  const at = nowIso()
  await claimThread({ tx: args.tx, threadId: args.threadId, userId: args.userId, at })

  const reusable = await loadReusable({
    tx: args.tx,
    threadId: args.threadId,
    userId: args.userId,
    drafts: args.drafts,
  })
  const plan = planAppend({ drafts: args.drafts, reusable })
  if (plan.fresh.length === 0) return plan.resolve([])

  const thread = await args.tx.thread.update({
    where: { id: args.threadId },
    data: { head: { increment: plan.fresh.length }, updatedAt: at },
    select: { head: true },
  })
  const firstSeq = thread.head - plan.fresh.length + 1

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
  await args.tx.event.createMany({ data: rows })

  return plan.resolve(rows.map(toEventDto))
}

export async function readOwnRows(args: {
  reader: SessionReader
  threadId: string
  userId: string
  upTo?: number | undefined
  type?: string | undefined
}): Promise<EventModel[]> {
  return args.reader.event.findMany({
    where: {
      threadId: args.threadId,
      userId: args.userId,
      ...(args.upTo === undefined ? {} : { seq: { lte: args.upTo } }),
      ...(args.type === undefined ? {} : { type: args.type }),
    },
    orderBy: { seq: 'asc' },
  })
}

export async function readComposedRows(args: {
  reader: SessionReader
  threadId: string
  userId: string
  upTo?: number | undefined
  type?: string | undefined
}): Promise<EventModel[]> {
  const segments = await planSegments({
    reader: args.reader,
    threadId: args.threadId,
    upTo: args.upTo,
  })

  const composed: EventModel[] = []
  for (const segment of segments) {
    composed.push(
      ...(await readOwnRows({
        reader: args.reader,
        threadId: segment.threadId,
        userId: args.userId,
        upTo: segment.upTo,
        ...(args.type === undefined ? {} : { type: args.type }),
      })),
    )
  }
  return composed
}

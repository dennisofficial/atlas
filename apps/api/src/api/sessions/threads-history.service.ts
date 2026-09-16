import { BadRequestException, Injectable } from '@nestjs/common'
import { db } from '../../db'
import type { Prisma } from '../../generated/prisma/client'
import { nextEventId, nextRunId, nextThreadId, nowIso } from './append'
import { ownedThread as requireOwnedThread } from './ownership'
import { toThreadDto } from './rows'
import type {
  CompactThreadDto,
  ForkThreadDto,
  RewindThreadDto,
  SummariseThreadDto,
} from './sessions.dto'
import type { ThreadDto } from './sessions.types'

const SURVIVES_SUMMARY = [
  'context-loaded',
  'permission-granted',
  'permission-revoked',
  'pull-request-linked',
]

type Tx = Prisma.TransactionClient

async function dropRewoundChildren(args: {
  tx: Tx
  userId: string
  agentIds: readonly string[]
}): Promise<void> {
  if (args.agentIds.length === 0) return

  const referenced = await args.tx.thread.findMany({
    where: {
      id: { in: [...args.agentIds] },
      userId: args.userId,
      OR: [{ forks: { some: {} } }, { spawned: { some: {} } }],
    },
    select: { id: true },
  })
  const referencedIds = new Set(referenced.map((row) => row.id))

  if (referencedIds.size > 0) {
    await args.tx.thread.updateMany({
      where: { id: { in: [...referencedIds] } },
      data: { spawnerThreadId: null, agentType: null },
    })
  }

  const removable = args.agentIds.filter((agentId) => !referencedIds.has(agentId))
  if (removable.length > 0) {
    await args.tx.thread.deleteMany({ where: { id: { in: removable }, userId: args.userId } })
  }
}

@Injectable()
export class ThreadsHistoryService {
  async rewind(args: { userId: string; threadId: string; draft: RewindThreadDto }): Promise<void> {
    await requireOwnedThread({ reader: db, userId: args.userId, threadId: args.threadId })
    const at = nowIso()
    await db.$transaction(async (tx) => {
      await tx.event.deleteMany({
        where: { threadId: args.threadId, userId: args.userId, seq: { gt: args.draft.toSeq } },
      })
      await dropRewoundChildren({ tx, userId: args.userId, agentIds: args.draft.cutAgents ?? [] })
      await tx.thread.update({
        where: { id: args.threadId },
        data: { head: args.draft.toSeq, updatedAt: at },
      })
    })
  }

  async compact(args: {
    userId: string
    threadId: string
    draft: CompactThreadDto
  }): Promise<{ replaced: number }> {
    return this.mark({ ...args, cutAgents: [], discardRows: false })
  }

  async summarise(args: {
    userId: string
    threadId: string
    draft: SummariseThreadDto
  }): Promise<{ replaced: number }> {
    return this.mark({ ...args, cutAgents: args.draft.cutAgents ?? [], discardRows: true })
  }

  async fork(args: { userId: string; threadId: string; draft: ForkThreadDto }): Promise<ThreadDto> {
    const source = await requireOwnedThread({
      reader: db,
      userId: args.userId,
      threadId: args.threadId,
    })
    if (args.draft.seq < 0 || args.draft.seq > source.head) {
      throw new BadRequestException(
        `cannot fork ${args.threadId} at ${args.draft.seq}: the thread runs from 0 to ${source.head}`,
      )
    }

    const at = nowIso()
    const into = nextThreadId()
    const row = await db.$transaction(async (tx) => {
      const created = await tx.thread.create({
        data: {
          id: into,
          userId: args.userId,
          head: args.draft.seq,
          createdAt: at,
          updatedAt: at,
          parentThreadId: args.threadId,
          forkSeq: args.draft.seq,
          forkMode: args.draft.mode,
          workspace: source.workspace,
          repo: source.repo,
          modelRef: source.modelRef,
          modelEffort: source.modelEffort,
          executionLocation: source.executionLocation,
          ...(args.draft.title === undefined ? {} : { title: args.draft.title }),
        },
      })

      if (args.draft.mode === 'copy') {
        const rows = await tx.event.findMany({
          where: { threadId: args.threadId, userId: args.userId, seq: { lte: args.draft.seq } },
          orderBy: { seq: 'asc' },
        })
        if (rows.length > 0) {
          await tx.event.createMany({
            data: rows.map(({ id: _id, ...row }) => ({
              ...row,
              id: nextEventId(),
              threadId: into,
            })),
          })
        }
      }

      return created
    })
    return toThreadDto(row)
  }

  private async mark(args: {
    userId: string
    threadId: string
    draft: CompactThreadDto
    discardRows: boolean
    cutAgents: readonly string[]
  }): Promise<{ replaced: number }> {
    await requireOwnedThread({ reader: db, userId: args.userId, threadId: args.threadId })
    const at = nowIso()

    return db.$transaction(async (tx) => {
      const covered = {
        threadId: args.threadId,
        userId: args.userId,
        seq: { gte: args.draft.fromSeq, lte: args.draft.throughSeq },
        type: { notIn: [...SURVIVES_SUMMARY] },
      }
      const vacated = (
        await tx.event.findMany({ where: covered, select: { seq: true }, orderBy: { seq: 'asc' } })
      ).map((row) => row.seq)
      const replaced = vacated.length
      if (args.discardRows) {
        await tx.event.deleteMany({ where: covered })
        await dropRewoundChildren({ tx, userId: args.userId, agentIds: args.cutAgents })
      }

      const standIn = args.discardRows
        ? args.draft.anchor === 'prefix'
          ? vacated.at(-1)
          : vacated[0]
        : undefined
      let seq = standIn
      if (seq === undefined) {
        const thread = await tx.thread.update({
          where: { id: args.threadId },
          data: { head: { increment: 1 }, updatedAt: at },
          select: { head: true },
        })
        seq = thread.head
      }

      await tx.event.create({
        data: {
          id: nextEventId(),
          threadId: args.threadId,
          seq,
          runId: nextRunId(),
          parentRunId: null,
          depth: 0,
          at,
          type: 'history-compacted',
          body: JSON.stringify({
            type: 'history-compacted',
            anchor: args.draft.anchor,
            fromSeq: args.draft.fromSeq,
            throughSeq: args.draft.throughSeq,
            summary: args.draft.summary,
            replaced,
          }),
          contextSlot: null,
          contextKey: null,
          contextDigest: null,
          userId: args.userId,
        },
      })
      await tx.thread.update({ where: { id: args.threadId }, data: { updatedAt: at } })

      return { replaced }
    })
  }
}

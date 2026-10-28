import { BadRequestException, Injectable } from '@nestjs/common'
import { db, or, type Tx } from '@dltech/atlas-db'
import type {
  CompactThreadInput,
  ForkThreadInput,
  RewindThreadInput,
  SummariseThreadInput,
} from '@dltech/atlas-wire'
import { nextEventId, nextRunId, nextThreadId } from './append'
import { ownedThread as requireOwnedThread } from './ownership'
import { toThreadDto } from './rows'
import { advanceHead } from './thread-head'
import { ThreadSignalsService } from './thread-signals.service'
import { SUBSCRIPTION_EVENT_TYPES } from './thread-subscriptions'
import type { ThreadDto } from './sessions.types'

const SURVIVES_SUMMARY = [
  'context-loaded',
  'permission-granted',
  'permission-revoked',
  'pull-request-linked',
  'subscription-created',
  'subscription-changed',
  'subscription-ended',
]

async function dropRewoundChildren(args: {
  tx: Tx
  userId: string
  agentIds: readonly string[]
}): Promise<void> {
  if (args.agentIds.length === 0) return

  const referenced = await args.tx.orm.public.Thread.where((thread) =>
    thread.id.in([...args.agentIds]),
  )
    .where({ userId: args.userId })
    .where((thread) => or(thread.forks.some(), thread.spawned.some()))
    .select('id')
    .all()
  const referencedIds = new Set(referenced.map((row) => row.id))

  if (referencedIds.size > 0) {
    await args.tx.orm.public.Thread.where((thread) =>
      thread.id.in([...referencedIds]),
    ).updateAndCount({ spawnerThreadId: null, agentType: null })
  }

  const removable = args.agentIds.filter((agentId) => !referencedIds.has(agentId))
  if (removable.length > 0) {
    await args.tx.orm.public.Thread.where((thread) => thread.id.in(removable))
      .where({ userId: args.userId })
      .deleteAndCount()
  }
}

@Injectable()
export class ThreadsHistoryService {
  constructor(private readonly signals: ThreadSignalsService) {}

  async rewind(args: {
    userId: string
    threadId: string
    draft: Omit<RewindThreadInput, 'threadId'>
  }): Promise<void> {
    await requireOwnedThread({ reader: db, userId: args.userId, threadId: args.threadId })
    const at = new Date()
    await db.transaction(async (tx) => {
      await tx.orm.public.Event.where({ threadId: args.threadId, userId: args.userId })
        .where((event) => event.seq.gt(args.draft.toSeq))
        .deleteAndCount()
      await dropRewoundChildren({ tx, userId: args.userId, agentIds: args.draft.cutAgents ?? [] })
      await tx.orm.public.Thread.where({ id: args.threadId }).update({
        head: args.draft.toSeq,
        updatedAt: at,
      })
    })
    await this.signals.headMoved({ threadId: args.threadId, head: args.draft.toSeq })
  }

  async compact(args: {
    userId: string
    threadId: string
    draft: Omit<CompactThreadInput, 'threadId'>
  }): Promise<{ replaced: number }> {
    return this.mark({ ...args, cutAgents: [], discardRows: false })
  }

  async summarise(args: {
    userId: string
    threadId: string
    draft: Omit<SummariseThreadInput, 'threadId'>
  }): Promise<{ replaced: number }> {
    return this.mark({ ...args, cutAgents: args.draft.cutAgents ?? [], discardRows: true })
  }

  async fork(args: {
    userId: string
    threadId: string
    draft: Omit<ForkThreadInput, 'threadId'>
  }): Promise<ThreadDto> {
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

    const at = new Date()
    const into = nextThreadId()
    const row = await db.transaction(async (tx) => {
      const created = await tx.orm.public.Thread.create({
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
        projectId: source.projectId,
        organizationId: source.organizationId,
        ...(args.draft.title === undefined ? {} : { title: args.draft.title }),
      })

      if (args.draft.mode === 'copy') {
        const rows = await tx.orm.public.Event.where({
          threadId: args.threadId,
          userId: args.userId,
        })
          .where((event) => event.seq.lte(args.draft.seq))
          .where((event) => event.type.notIn(SUBSCRIPTION_EVENT_TYPES))
          .orderBy((event) => event.seq.asc())
          .all()
        if (rows.length > 0) {
          await tx.orm.public.Event.createAndCount(
            rows.map((row) => ({ ...row, id: nextEventId(), threadId: into })),
          )
        }
      }

      return created
    })
    return toThreadDto(row)
  }

  private async mark(args: {
    userId: string
    threadId: string
    draft: Omit<CompactThreadInput, 'threadId'>
    discardRows: boolean
    cutAgents: readonly string[]
  }): Promise<{ replaced: number }> {
    await requireOwnedThread({ reader: db, userId: args.userId, threadId: args.threadId })
    const at = new Date()

    const marked = await db.transaction(async (tx) => {
      const covered = tx.orm.public.Event.where({ threadId: args.threadId, userId: args.userId })
        .where((event) => event.seq.gte(args.draft.fromSeq))
        .where((event) => event.seq.lte(args.draft.throughSeq))
        .where((event) => event.type.notIn(SURVIVES_SUMMARY))
      const vacated = (
        await covered
          .select('seq')
          .orderBy((event) => event.seq.asc())
          .all()
      ).map((row) => row.seq)
      const replaced = vacated.length
      if (args.discardRows) {
        await covered.deleteAndCount()
        await dropRewoundChildren({ tx, userId: args.userId, agentIds: args.cutAgents })
      }

      const standIn = args.discardRows
        ? args.draft.anchor === 'prefix'
          ? vacated.at(-1)
          : vacated[0]
        : undefined
      let seq = standIn
      if (seq === undefined) {
        seq = await advanceHead({ tx, threadId: args.threadId, by: 1, at })
      }

      await tx.orm.public.Event.create({
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
      })
      await tx.orm.public.Thread.where({ id: args.threadId }).update({ updatedAt: at })

      const thread = await tx.orm.public.Thread.where({ id: args.threadId }).all().firstOrThrow()
      return { replaced, head: thread.head }
    })
    await this.signals.headMoved({ threadId: args.threadId, head: marked.head })
    return { replaced: marked.replaced }
  }
}

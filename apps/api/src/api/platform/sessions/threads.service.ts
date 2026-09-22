import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common'
import { db } from '../../../db'
import { appendWithin, nextThreadId, nowIso } from './append'
import { ownedThread as requireOwnedThread } from './ownership'
import { threadPullRequests, threadWorktree } from './places'
import { toEventDto, toThreadDto } from './rows'
import type {
  AdoptThreadDto,
  ChooseLocationDto,
  ChooseModelDto,
  CreateThreadDto,
  OpenThreadDto,
  RenameThreadDto,
} from './sessions.dto'
import type { EventDto, ThreadDto } from './sessions.types'

const THREAD_LISTING_LIMIT = 50

@Injectable()
export class ThreadsService {
  async create(args: { userId: string; draft: CreateThreadDto }): Promise<ThreadDto> {
    const at = nowIso()
    const row = await db.thread.create({
      data: {
        id: nextThreadId(),
        userId: args.userId,
        createdAt: at,
        updatedAt: at,
        ...(args.draft.title === undefined ? {} : { title: args.draft.title }),
        ...(args.draft.workspace === undefined ? {} : { workspace: args.draft.workspace }),
        ...(args.draft.repo === undefined ? {} : { repo: args.draft.repo }),
        ...(args.draft.agent === undefined
          ? {}
          : { spawnerThreadId: args.draft.agent.spawnedBy, agentType: args.draft.agent.type }),
      },
    })
    return toThreadDto(row)
  }

  async open(args: {
    userId: string
    draft: OpenThreadDto
  }): Promise<{ thread: ThreadDto; events: EventDto[] }> {
    const threadId = args.draft.threadId ?? nextThreadId()
    const existing = await db.thread.findUnique({ where: { id: threadId }, select: { id: true } })
    if (existing !== null) return this.reopen({ userId: args.userId, draft: args.draft, threadId })

    return db.$transaction(async (tx) => {
      const at = nowIso()
      await tx.thread.create({
        data: {
          id: threadId,
          userId: args.userId,
          createdAt: at,
          updatedAt: at,
          ...(args.draft.title === undefined ? {} : { title: args.draft.title }),
          ...(args.draft.workspace === undefined ? {} : { workspace: args.draft.workspace }),
          ...(args.draft.repo === undefined ? {} : { repo: args.draft.repo }),
          ...(args.draft.executionLocation === undefined
            ? {}
            : { executionLocation: args.draft.executionLocation }),
          ...(args.draft.agent === undefined
            ? {}
            : { spawnerThreadId: args.draft.agent.spawnedBy, agentType: args.draft.agent.type }),
        },
      })
      const events = await appendWithin({
        tx,
        threadId,
        userId: args.userId,
        runId: args.draft.runId,
        drafts: args.draft.drafts,
      })
      const row = await tx.thread.findUniqueOrThrow({ where: { id: threadId } })
      return { thread: toThreadDto(row), events }
    })
  }

  /**
   * A transfer that already landed is replayed whole by the caller — the edge may have timed out
   * after the commit — so re-opening appends only what the stored log has not seen and refuses a
   * draft list that no longer has that log as its prefix.
   */
  private async reopen(args: {
    userId: string
    draft: OpenThreadDto
    threadId: string
  }): Promise<{ thread: ThreadDto; events: EventDto[] }> {
    return db.$transaction(async (tx) => {
      const row = await tx.thread.findUniqueOrThrow({ where: { id: args.threadId } })
      if (row.userId !== args.userId) throw new ForbiddenException('thread belongs to another user')

      const storedCount = row.head
      if (args.draft.drafts.length < storedCount) {
        throw new ConflictException(
          'the conversation is shorter than its cloud copy — refusing to clobber it',
        )
      }
      if (storedCount > 0) {
        const boundary = await tx.event.findFirst({
          where: { threadId: args.threadId, seq: storedCount },
          select: { type: true, body: true },
        })
        const replayed = args.draft.drafts[storedCount - 1]
        if (
          boundary === null ||
          replayed === undefined ||
          replayed.type !== boundary.type ||
          replayed.body !== boundary.body
        ) {
          throw new ConflictException('the conversation has diverged from its cloud copy')
        }
      }

      const novel = args.draft.drafts.slice(storedCount)
      if (novel.length > 0) {
        await appendWithin({
          tx,
          threadId: args.threadId,
          userId: args.userId,
          runId: args.draft.runId,
          drafts: novel,
        })
      }

      const updated = await tx.thread.update({
        where: { id: args.threadId },
        data: {
          updatedAt: nowIso(),
          ...(args.draft.title === undefined ? {} : { title: args.draft.title }),
          ...(args.draft.workspace === undefined ? {} : { workspace: args.draft.workspace }),
          ...(args.draft.repo === undefined ? {} : { repo: args.draft.repo }),
          ...(args.draft.executionLocation === undefined
            ? {}
            : { executionLocation: args.draft.executionLocation }),
        },
      })

      const events = await tx.event.findMany({
        where: { threadId: args.threadId },
        orderBy: { seq: 'asc' },
      })
      return { thread: toThreadDto(updated), events: events.map(toEventDto) }
    })
  }

  async find(args: { userId: string; threadId: string }): Promise<ThreadDto> {
    return toThreadDto(await this.ownedThread(args))
  }

  async spawned(args: { userId: string; threadId: string }): Promise<ThreadDto[]> {
    await this.ownedThread(args)
    const rows = await db.thread.findMany({
      where: { spawnerThreadId: args.threadId, userId: args.userId },
      orderBy: { createdAt: 'asc' },
    })
    return rows.map(toThreadDto)
  }

  async mostRecent(args: { userId: string; project: string }): Promise<ThreadDto | null> {
    const row = await db.thread.findFirst({
      where: {
        userId: args.userId,
        OR: [{ repo: args.project }, { workspace: args.project }],
      },
      orderBy: { updatedAt: 'desc' },
    })
    return row === null ? null : toThreadDto(row)
  }

  async list(args: {
    userId: string
    project: string
    limit?: number | undefined
  }): Promise<ThreadDto[]> {
    const rows = await db.thread.findMany({
      where: {
        userId: args.userId,
        OR: [{ repo: args.project }, { workspace: args.project }],
      },
      orderBy: { updatedAt: 'desc' },
      take: args.limit ?? THREAD_LISTING_LIMIT,
    })
    return Promise.all(
      rows.map(async (row) => {
        const [worktree, pullRequests] = await Promise.all([
          threadWorktree({ reader: db, threadId: row.id }),
          threadPullRequests({ reader: db, threadId: row.id }),
        ])
        return {
          ...toThreadDto(row),
          ...(worktree === null ? {} : { worktree }),
          ...(pullRequests.length === 0 ? {} : { pullRequests }),
        }
      }),
    )
  }

  async rename(args: { userId: string; threadId: string; draft: RenameThreadDto }): Promise<void> {
    await this.ownedThread(args)
    await db.thread.update({ where: { id: args.threadId }, data: { title: args.draft.title } })
  }

  async chooseModel(args: {
    userId: string
    threadId: string
    draft: ChooseModelDto
  }): Promise<void> {
    await this.ownedThread(args)
    await db.thread.update({
      where: { id: args.threadId },
      data: { modelRef: args.draft.ref, modelEffort: args.draft.effort },
    })
  }

  async chooseLocation(args: {
    userId: string
    threadId: string
    draft: ChooseLocationDto
  }): Promise<void> {
    await this.ownedThread(args)
    await db.thread.update({
      where: { id: args.threadId },
      data: { executionLocation: args.draft.location },
    })
  }

  async adopt(args: { userId: string; threadId: string; draft: AdoptThreadDto }): Promise<void> {
    await this.ownedThread(args)
    await db.thread.update({
      where: { id: args.threadId },
      data: { workspace: args.draft.workspace, repo: args.draft.repo },
    })
  }

  private ownedThread(args: { userId: string; threadId: string }) {
    return requireOwnedThread({ reader: db, userId: args.userId, threadId: args.threadId })
  }
}

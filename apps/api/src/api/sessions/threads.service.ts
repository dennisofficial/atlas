import { Injectable } from '@nestjs/common'
import { db } from '../../db'
import { appendWithin, nextThreadId, nowIso } from './append'
import { ownedThread as requireOwnedThread } from './ownership'
import { threadPullRequests, threadWorktree } from './places'
import { toThreadDto } from './rows'
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

import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { db, or, type Row, type Tx } from '@dltech/atlas-db'
import type {
  AdoptThreadInput,
  ChooseThreadModelInput,
  CreateThreadInput,
  OpenThreadInput,
  RenameThreadInput,
} from '@dltech/atlas-wire'
import { appendWithin, nextThreadId } from './append'
import { ownedThread as requireOwnedThread } from './ownership'
import { toEventDto, toThreadDto } from './rows'
import { enrichThreads } from './thread-enrichment'
import { ThreadSignalsService } from './thread-signals.service'
import { threadProjectColumn, type ThreadProjectColumns } from './thread-project'
import type { EventDto, ThreadDraft, ThreadDto } from './sessions.types'

const THREAD_LISTING_LIMIT = 50

export type OpenThreadDraft = Omit<OpenThreadInput, 'id'> & { threadId?: string | undefined }

const createColumnsOf = (args: {
  userId: string
  draft: ThreadDraft
  project: ThreadProjectColumns
}) => {
  const { draft } = args
  return {
    id: nextThreadId(),
    userId: args.userId,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...(draft.title === undefined ? {} : { title: draft.title }),
    ...(draft.workspace === undefined ? {} : { workspace: draft.workspace }),
    ...(draft.repo === undefined ? {} : { repo: draft.repo }),
    ...(draft.model === undefined ? {} : { modelRef: draft.model }),
    ...(draft.effort === undefined ? {} : { modelEffort: draft.effort }),
    ...args.project,
    ...(draft.agent === undefined
      ? {}
      : { spawnerThreadId: draft.agent.spawnedBy, agentType: draft.agent.type }),
  }
}

@Injectable()
export class ThreadsService {
  constructor(private readonly signals: ThreadSignalsService) {}

  async create(args: { userId: string; draft: CreateThreadInput }): Promise<ThreadDto> {
    const project = await threadProjectColumn({
      userId: args.userId,
      projectId: args.draft.projectId,
    })
    const row = await db.orm.public.Thread.create(
      createColumnsOf({ userId: args.userId, draft: args.draft, project }),
    )
    return toThreadDto(row)
  }

  async createWithin(args: {
    tx: Tx
    userId: string
    draft: ThreadDraft
    project: ThreadProjectColumns
  }): Promise<Row<'Thread'>> {
    return args.tx.orm.public.Thread.create({
      ...createColumnsOf(args),
      executionLocation: 'cloud',
    })
  }

  async open(args: {
    userId: string
    draft: OpenThreadDraft
  }): Promise<{ thread: ThreadDto; events: EventDto[] }> {
    const threadId = args.draft.threadId ?? nextThreadId()
    const existing = await db.orm.public.Thread.where({ id: threadId }).select('id').first()
    if (existing !== null) {
      const reopened = await this.reopen({ userId: args.userId, draft: args.draft, threadId })
      if (reopened.moved) {
        await this.signals.headMoved({ threadId, head: reopened.thread.head })
      }
      return { thread: reopened.thread, events: reopened.events }
    }

    return db.transaction(async (tx) => {
      const at = new Date()
      await tx.orm.public.Thread.create({
        id: threadId,
        userId: args.userId,
        createdAt: at,
        updatedAt: at,
        ...(args.draft.title === undefined ? {} : { title: args.draft.title }),
        ...(args.draft.workspace === undefined ? {} : { workspace: args.draft.workspace }),
        ...(args.draft.repo === undefined ? {} : { repo: args.draft.repo }),
        ...(await threadProjectColumn({ userId: args.userId, projectId: args.draft.projectId })),
        ...(args.draft.executionLocation === undefined
          ? {}
          : { executionLocation: args.draft.executionLocation }),
        ...(args.draft.agent === undefined
          ? {}
          : { spawnerThreadId: args.draft.agent.spawnedBy, agentType: args.draft.agent.type }),
      })
      const events = await appendWithin({
        tx,
        threadId,
        userId: args.userId,
        runId: args.draft.runId,
        drafts: args.draft.drafts,
      })
      const row = await tx.orm.public.Thread.where({ id: threadId }).all().firstOrThrow()
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
    draft: OpenThreadDraft
    threadId: string
  }): Promise<{ thread: ThreadDto; events: EventDto[]; moved: boolean }> {
    return db.transaction(async (tx) => {
      const row = await tx.orm.public.Thread.where({ id: args.threadId }).all().firstOrThrow()
      if (row.userId !== args.userId) throw new ForbiddenException('thread belongs to another user')

      const storedCount = row.head
      if (args.draft.drafts.length < storedCount) {
        throw new ConflictException(
          'the conversation is shorter than its cloud copy — refusing to clobber it',
        )
      }
      if (storedCount > 0) {
        const boundary = await tx.orm.public.Event.where({
          threadId: args.threadId,
          seq: storedCount,
        })
          .select('type', 'body')
          .first()
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

      const updated = await tx.orm.public.Thread.where({ id: args.threadId }).update({
        updatedAt: new Date(),
        ...(args.draft.title === undefined ? {} : { title: args.draft.title }),
        ...(args.draft.workspace === undefined ? {} : { workspace: args.draft.workspace }),
        ...(args.draft.repo === undefined ? {} : { repo: args.draft.repo }),
        ...(args.draft.executionLocation === undefined
          ? {}
          : { executionLocation: args.draft.executionLocation }),
      })
      if (updated === null) throw new NotFoundException('thread not found')

      const events = await tx.orm.public.Event.where({ threadId: args.threadId })
        .orderBy((event) => event.seq.asc())
        .all()
      return {
        thread: toThreadDto(updated),
        events: events.map(toEventDto),
        moved: novel.length > 0,
      }
    })
  }

  async find(args: { userId: string; threadId: string }): Promise<ThreadDto> {
    const [thread] = await enrichThreads([await this.ownedThread(args)])
    if (thread === undefined) throw new NotFoundException('thread not found')
    return thread
  }

  async spawned(args: { userId: string; threadId: string }): Promise<ThreadDto[]> {
    await this.ownedThread(args)
    const rows = await db.orm.public.Thread.where({
      spawnerThreadId: args.threadId,
      userId: args.userId,
    })
      .orderBy((thread) => thread.createdAt.asc())
      .all()
    return rows.map(toThreadDto)
  }

  async mostRecent(args: { userId: string; project: string }): Promise<ThreadDto | null> {
    const row = await db.orm.public.Thread.where({ userId: args.userId })
      .where((thread) => or(thread.repo.eq(args.project), thread.workspace.eq(args.project)))
      .orderBy((thread) => thread.updatedAt.desc())
      .first()
    return row === null ? null : toThreadDto(row)
  }

  async list(args: {
    userId: string
    project?: string | undefined
    projectId?: string | undefined
    limit?: number | undefined
  }): Promise<ThreadDto[]> {
    const { project, projectId } = args
    const owned = db.orm.public.Thread.where({ userId: args.userId })
    const scoped =
      projectId === undefined
        ? owned.where((thread) =>
            or(thread.repo.eq(project ?? ''), thread.workspace.eq(project ?? '')),
          )
        : owned.where({ projectId })
    const rows = await scoped
      .orderBy((thread) => thread.updatedAt.desc())
      .limit(args.limit ?? THREAD_LISTING_LIMIT)
      .all()
    return enrichThreads(rows)
  }

  async rename(args: {
    userId: string
    threadId: string
    draft: Omit<RenameThreadInput, 'threadId'>
  }): Promise<void> {
    await this.ownedThread(args)
    await db.orm.public.Thread.where({ id: args.threadId }).update({ title: args.draft.title })
  }

  async chooseModel(args: {
    userId: string
    threadId: string
    draft: Omit<ChooseThreadModelInput, 'threadId'>
  }): Promise<void> {
    await this.ownedThread(args)
    await db.orm.public.Thread.where({ id: args.threadId }).update({
      modelRef: args.draft.ref,
      modelEffort: args.draft.effort,
    })
  }

  async adopt(args: {
    userId: string
    threadId: string
    draft: Omit<AdoptThreadInput, 'threadId'>
  }): Promise<void> {
    await this.ownedThread(args)
    await db.orm.public.Thread.where({ id: args.threadId }).update({
      workspace: args.draft.workspace,
      ...(args.draft.repo === undefined ? {} : { repo: args.draft.repo }),
    })
  }

  private ownedThread(args: { userId: string; threadId: string }) {
    return requireOwnedThread({ reader: db, userId: args.userId, threadId: args.threadId })
  }
}

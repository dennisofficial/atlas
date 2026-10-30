import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { db, type Row, type Tx } from '@dltech/atlas-db'
import type {
  AdoptThreadInput,
  ChooseThreadModelInput,
  CreateThreadInput,
  OpenThreadInput,
  RenameThreadInput,
} from '@dltech/atlas-wire'
import { appendWithin, nextThreadId } from './append'
import { withSessions } from './thread-with-session'
import { sessionOfThread } from './session-of-thread'
import { listMainThreads, THREAD_LISTING_LIMIT } from './main-thread-listing'
import { withinFamily } from './within-family'
import { createDraftThread } from './create-session'
import { createColumnsOf } from './thread-create-columns'
import { ownedThread as requireOwnedThread } from './ownership'
import { toEventDto, toThreadDto } from './rows'
import { enrichThreads } from './thread-enrichment'
import { ThreadSignalsService } from './thread-signals.service'
import { threadProjectColumn, type ThreadProjectColumns } from './thread-project'
import type { EventDto, ThreadDraft, ThreadDto } from './sessions.types'

export type OpenThreadDraft = Omit<OpenThreadInput, 'id'> & {
  threadId?: string | undefined
}

@Injectable()
export class ThreadsService {
  constructor(private readonly signals: ThreadSignalsService) {}

  async create(args: { userId: string; draft: CreateThreadInput }): Promise<ThreadDto> {
    const project = await threadProjectColumn({
      userId: args.userId,
      projectId: args.draft.projectId,
    })
    const columns = createColumnsOf({
      userId: args.userId,
      draft: args.draft,
      project,
    })
    const created = await db.transaction(async (tx) => {
      const taken = await tx.orm.public.Thread.where({ id: columns.thread.id }).select('id').first()
      if (taken !== null) throw new ConflictException('thread id is already in use')
      return createDraftThread({ tx, ...columns })
    })
    await this.signals.listChanged({
      userId: args.userId,
      threadId: created.thread.id,
    })
    return toThreadDto(created)
  }

  async announceCreated(args: { userId: string; threadId: string }): Promise<void> {
    await this.signals.listChanged(args)
  }

  async createWithin(args: {
    tx: Tx
    userId: string
    draft: ThreadDraft
    project: ThreadProjectColumns
  }): Promise<Row<'Thread'>> {
    const columns = createColumnsOf(args)
    const { thread } = await createDraftThread({
      tx: args.tx,
      ...columns,
      session: { ...columns.session, executionLocation: 'cloud' },
    })
    return thread
  }

  async open(args: {
    userId: string
    confinedTo?: string | undefined
    draft: OpenThreadDraft
  }): Promise<{ thread: ThreadDto; events: EventDto[] }> {
    const threadId = args.draft.threadId ?? nextThreadId()
    const existing = await db.orm.public.Thread.where({ id: threadId }).select('id').first()
    if (existing !== null) {
      const reopened = await this.reopen({
        userId: args.userId,
        confinedTo: args.confinedTo,
        draft: args.draft,
        threadId,
      })
      if (reopened.moved) {
        await this.signals.headMoved({ threadId, head: reopened.thread.head })
      }
      return { thread: reopened.thread, events: reopened.events }
    }

    const opened = await db.transaction(async (tx) => {
      const at = new Date()
      const project = await threadProjectColumn({
        userId: args.userId,
        projectId: args.draft.projectId,
      })
      const columns = createColumnsOf({
        userId: args.userId,
        project,
        draft: {
          id: threadId,
          title: args.draft.title,
          workspace: args.draft.workspace,
          repo: args.draft.repo,
          agent: args.draft.agent,
        },
      })
      const created = await createDraftThread({
        tx,
        agent: columns.agent,
        thread: { ...columns.thread, createdAt: at, updatedAt: at },
        session: {
          ...columns.session,
          executionLocation: args.draft.executionLocation,
          createdAt: at,
          updatedAt: at,
        },
      })
      const events = await appendWithin({
        tx,
        threadId,
        userId: args.userId,
        runId: args.draft.runId,
        drafts: args.draft.drafts,
      })
      const row = await tx.orm.public.Thread.where({ id: threadId }).all().firstOrThrow()
      return {
        thread: toThreadDto({ thread: row, session: created.session }),
        events,
      }
    })
    await this.signals.listChanged({ userId: args.userId, threadId })
    return opened
  }

  /**
   * A transfer that already landed is replayed whole by the caller — the edge may have timed out
   * after the commit — so re-opening appends only what the stored log has not seen and refuses a
   * draft list that no longer has that log as its prefix.
   */
  private async reopen(args: {
    userId: string
    confinedTo: string | undefined
    draft: OpenThreadDraft
    threadId: string
  }): Promise<{ thread: ThreadDto; events: EventDto[]; moved: boolean }> {
    return db.transaction(async (tx) => {
      const row = await tx.orm.public.Thread.where({ id: args.threadId }).all().firstOrThrow()
      if (row.userId !== args.userId) throw new ForbiddenException('thread belongs to another user')
      if (!withinFamily({ row, confinedTo: args.confinedTo })) {
        throw new ForbiddenException('a pod or sandbox token reopens only its own thread family')
      }

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

      const updated = await tx.orm.public.Thread.where({
        id: args.threadId,
      }).update({
        updatedAt: new Date(),
      })
      if (updated === null) throw new NotFoundException('thread not found')
      const session = await tx.orm.public.Session.where({
        id: updated.sessionId,
      }).update({
        updatedAt: new Date(),
        ...(args.draft.title === undefined ? {} : { title: args.draft.title }),
        ...(args.draft.workspace === undefined ? {} : { workspace: args.draft.workspace }),
        ...(args.draft.repo === undefined ? {} : { repo: args.draft.repo }),
        ...(args.draft.executionLocation === undefined
          ? {}
          : { executionLocation: args.draft.executionLocation }),
      })
      if (session === null) throw new NotFoundException('thread not found')

      const events = await tx.orm.public.Event.where({
        threadId: args.threadId,
      })
        .orderBy((event) => event.seq.asc())
        .all()
      return {
        thread: toThreadDto({ thread: updated, session }),
        events: events.map(toEventDto),
        moved: novel.length > 0,
      }
    })
  }

  async find(args: { userId: string; threadId: string }): Promise<ThreadDto> {
    const [thread] = await enrichThreads({
      rows: await withSessions({
        reader: db,
        threads: [await this.ownedThread(args)],
      }),
      viewerId: args.userId,
    })
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
    return (await withSessions({ reader: db, threads: rows })).map(toThreadDto)
  }

  async mostRecent(args: { userId: string; project: string }): Promise<ThreadDto | null> {
    const [row] = await listMainThreads({
      userId: args.userId,
      scope: { project: args.project },
      limit: 1,
    })
    return row === undefined ? null : toThreadDto(row)
  }

  async list(args: {
    userId: string
    project?: string | undefined
    projectId?: string | undefined
    limit?: number | undefined
  }): Promise<ThreadDto[]> {
    const { project, projectId } = args
    const rows = await listMainThreads({
      userId: args.userId,
      scope: projectId === undefined ? { project: project ?? '' } : { projectId },
      limit: args.limit ?? THREAD_LISTING_LIMIT,
    })
    return enrichThreads({ rows, viewerId: args.userId })
  }

  async rename(args: {
    userId: string
    threadId: string
    draft: Omit<RenameThreadInput, 'threadId'>
  }): Promise<void> {
    await this.ownedThread(args)
    const session = await sessionOfThread({
      reader: db,
      threadId: args.threadId,
    })
    await db.orm.public.Session.where({ id: session.id }).update({
      title: args.draft.title,
    })
    await this.signals.titleChanged({ threadId: args.threadId })
    await this.signals.listChanged({
      userId: args.userId,
      threadId: args.threadId,
    })
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
    this.signals.threadChanged({ threadId: args.threadId })
  }

  async adopt(args: {
    userId: string
    threadId: string
    draft: Omit<AdoptThreadInput, 'threadId'>
  }): Promise<void> {
    await this.ownedThread(args)
    const session = await sessionOfThread({
      reader: db,
      threadId: args.threadId,
    })
    await db.orm.public.Session.where({ id: session.id }).update({
      workspace: args.draft.workspace,
      ...(args.draft.repo === undefined ? {} : { repo: args.draft.repo }),
    })
    this.signals.threadChanged({ threadId: args.threadId })
  }

  private ownedThread(args: { userId: string; threadId: string }) {
    return requireOwnedThread({
      reader: db,
      userId: args.userId,
      threadId: args.threadId,
    })
  }
}

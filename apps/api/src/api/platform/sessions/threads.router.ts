import {
  adoptThreadInputSchema,
  archiveThreadInputSchema,
  chooseThreadModelInputSchema,
  compactThreadInputSchema,
  createThreadInputSchema,
  createThreadOutputSchema,
  forkThreadInputSchema,
  listThreadsInputSchema,
  markThreadReadInputSchema,
  openThreadInputSchema,
  openThreadReplySchema,
  recentThreadInputSchema,
  renameThreadInputSchema,
  replacedReplySchema,
  rewindThreadInputSchema,
  summariseThreadInputSchema,
  threadIdInputSchema,
  threadLiveOutputSchema,
  wireThreadSchema,
  type AdoptThreadInput,
  type ArchiveThreadInput,
  type ChooseThreadModelInput,
  type CompactThreadInput,
  type CreateThreadInput,
  type ForkThreadInput,
  type ListThreadsInput,
  type MarkThreadReadInput,
  type OpenThreadInput,
  type RecentThreadInput,
  type RenameThreadInput,
  type ReplacedReply,
  type RewindThreadInput,
  type SummariseThreadInput,
  type ThreadIdInput,
  type ThreadLiveFrame,
} from '@dltech/atlas-wire'
import { ServiceUnavailableException } from '@nestjs/common'
import {
  Ctx,
  Input,
  Mutation,
  Options,
  type ProcedureOptions,
  Query,
  Router,
  Subscription,
  UseMiddlewares,
} from 'nestjs-trpc'
import { z } from 'zod'
import { ThreadLauncher, type ThreadLaunchReply } from '../../../_core/ports/thread-launcher'
import { meta } from '../../../_module/trpc/procedure-meta'
import { CLIENT_READ_LIMIT_PER_MINUTE } from '../../client-rate-limit'
import { DrainStateService } from '../health/drain-state.service'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import type { EventDto, ThreadDto } from './sessions.types'
import { ThreadArchiveService } from './thread-archive.service'
import { ThreadReadService } from './thread-read.service'
import { liveSnapshot } from './live-snapshot'
import { ThreadSignalsService } from './thread-signals.service'
import { attachLiveStream } from './thread-live-stream'
import { threadStreamFrames } from './thread-stream.frames'
import { ThreadsHistoryService } from './threads-history.service'
import { ThreadsService } from './threads.service'

const READ_THROTTLE = { limit: CLIENT_READ_LIMIT_PER_MINUTE, ttlMs: 60_000 }
const readMeta = meta({ throttle: READ_THROTTLE })
const spawnMeta = meta({ throttle: READ_THROTTLE })

@Router({ alias: 'threads' })
@UseMiddlewares(SessionMiddleware)
export class ThreadsRouter {
  constructor(
    private readonly threads: ThreadsService,
    private readonly history: ThreadsHistoryService,
    private readonly launcher: ThreadLauncher,
    private readonly archival: ThreadArchiveService,
    private readonly reads: ThreadReadService,
    private readonly signals: ThreadSignalsService,
    private readonly drain: DrainStateService,
  ) {}

  // Glossary: creates a session and its main thread (CONTEXT.md).
  @Mutation({ input: createThreadInputSchema, output: createThreadOutputSchema, meta: spawnMeta })
  async create(
    @Input() input: CreateThreadInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<ThreadDto | ThreadLaunchReply> {
    const userId = ctx.auth.userId
    if (input.firstMessage === undefined) return this.threads.create({ userId, draft: input })
    return this.launcher.launch({ userId, draft: input, firstMessage: input.firstMessage })
  }

  // Glossary: creates a session and its main thread, reopening the thread when the id already exists (CONTEXT.md).
  @Mutation({ input: openThreadInputSchema, output: openThreadReplySchema, meta: spawnMeta })
  async open(
    @Input() input: OpenThreadInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<{ thread: ThreadDto; events: EventDto[] }> {
    const { id, ...rest } = input
    return this.threads.open({
      userId: ctx.auth.userId,
      draft: { ...rest, threadId: id },
    })
  }

  // Glossary: the newest main thread among the project's sessions, so it finds the session to reopen (CONTEXT.md).
  @Query({ input: recentThreadInputSchema, output: wireThreadSchema.nullable(), meta: readMeta })
  recent(@Input() input: RecentThreadInput, @Ctx() ctx: SessionTrpcCtx): Promise<ThreadDto | null> {
    return this.threads.mostRecent({ userId: ctx.auth.userId, project: input.project })
  }

  @Query({ input: listThreadsInputSchema, output: z.array(wireThreadSchema), meta: readMeta })
  list(@Input() input: ListThreadsInput, @Ctx() ctx: SessionTrpcCtx): Promise<ThreadDto[]> {
    return this.threads.list({ userId: ctx.auth.userId, ...input })
  }

  @Query({ input: threadIdInputSchema, output: wireThreadSchema, meta: readMeta })
  get(@Input() input: ThreadIdInput, @Ctx() ctx: SessionTrpcCtx): Promise<ThreadDto> {
    return this.threads.find({ userId: ctx.auth.userId, threadId: input.threadId })
  }

  @Query({ input: threadIdInputSchema, output: z.array(wireThreadSchema), meta: readMeta })
  spawned(@Input() input: ThreadIdInput, @Ctx() ctx: SessionTrpcCtx): Promise<ThreadDto[]> {
    return this.threads.spawned({ userId: ctx.auth.userId, threadId: input.threadId })
  }

  @Mutation({ input: renameThreadInputSchema, output: z.void(), meta: readMeta })
  async rename(@Input() input: RenameThreadInput, @Ctx() ctx: SessionTrpcCtx): Promise<void> {
    await this.threads.rename({ userId: ctx.auth.userId, threadId: input.threadId, draft: input })
  }

  @Mutation({ input: archiveThreadInputSchema, output: z.void(), meta: readMeta })
  async archive(@Input() input: ArchiveThreadInput, @Ctx() ctx: SessionTrpcCtx): Promise<void> {
    await this.archival.setArchived({
      userId: ctx.auth.userId,
      threadId: input.threadId,
      archived: input.archived,
    })
  }

  @Mutation({ input: markThreadReadInputSchema, output: z.void(), meta: readMeta })
  async markRead(@Input() input: MarkThreadReadInput, @Ctx() ctx: SessionTrpcCtx): Promise<void> {
    await this.reads.markRead({ userId: ctx.auth.userId, threadId: input.threadId, seq: input.seq })
  }

  @Subscription({ output: threadLiveOutputSchema, meta: readMeta })
  live(
    @Ctx() ctx: SessionTrpcCtx,
    @Options() opts: ProcedureOptions,
  ): AsyncGenerator<ThreadLiveFrame> {
    if (this.drain.isDraining()) {
      throw new ServiceUnavailableException('the api is restarting — retry the stream')
    }
    const userId = ctx.auth.userId
    return threadStreamFrames<ThreadLiveFrame>({
      signal: opts.signal,
      attach: (sink) =>
        attachLiveStream({
          signals: this.signals,
          userId,
          readSnapshot: () => liveSnapshot({ userId }),
          sink,
        }),
    })
  }

  @Mutation({ input: chooseThreadModelInputSchema, output: z.void(), meta: readMeta })
  async chooseModel(
    @Input() input: ChooseThreadModelInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<void> {
    await this.threads.chooseModel({
      userId: ctx.auth.userId,
      threadId: input.threadId,
      draft: input,
    })
  }

  @Mutation({ input: adoptThreadInputSchema, output: z.void(), meta: readMeta })
  async adopt(@Input() input: AdoptThreadInput, @Ctx() ctx: SessionTrpcCtx): Promise<void> {
    await this.threads.adopt({ userId: ctx.auth.userId, threadId: input.threadId, draft: input })
  }

  @Mutation({ input: rewindThreadInputSchema, output: z.void(), meta: readMeta })
  async rewind(@Input() input: RewindThreadInput, @Ctx() ctx: SessionTrpcCtx): Promise<void> {
    await this.history.rewind({ userId: ctx.auth.userId, threadId: input.threadId, draft: input })
  }

  @Mutation({ input: compactThreadInputSchema, output: replacedReplySchema, meta: readMeta })
  compact(@Input() input: CompactThreadInput, @Ctx() ctx: SessionTrpcCtx): Promise<ReplacedReply> {
    return this.history.compact({ userId: ctx.auth.userId, threadId: input.threadId, draft: input })
  }

  @Mutation({ input: summariseThreadInputSchema, output: replacedReplySchema, meta: readMeta })
  summarise(
    @Input() input: SummariseThreadInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<ReplacedReply> {
    return this.history.summarise({
      userId: ctx.auth.userId,
      threadId: input.threadId,
      draft: input,
    })
  }

  @Mutation({ input: forkThreadInputSchema, output: wireThreadSchema, meta: readMeta })
  fork(@Input() input: ForkThreadInput, @Ctx() ctx: SessionTrpcCtx): Promise<ThreadDto> {
    return this.history.fork({ userId: ctx.auth.userId, threadId: input.threadId, draft: input })
  }
}

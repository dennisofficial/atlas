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
  type SupervisedAgentInput,
  type ThreadIdInput,
} from '@dltech/atlas-wire'
import { ForbiddenException } from '@nestjs/common'
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { z } from 'zod'
import { ThreadLauncher, type ThreadLaunchReply } from '../../../_core/ports/thread-launcher'
import { meta } from '../../../_module/trpc/procedure-meta'
import { CLIENT_READ_LIMIT_PER_MINUTE } from '../../client-rate-limit'
import {
  SessionOrSandboxMiddleware,
  type SessionOrSandboxTrpcCtx,
} from './session-or-sandbox.middleware'
import type { EventDto, ThreadDto } from './sessions.types'
import { ThreadArchiveService } from './thread-archive.service'
import { ThreadReadService } from './thread-read.service'
import { ThreadsHistoryService } from './threads-history.service'
import { ThreadsService } from './threads.service'

const READ_THROTTLE = { limit: CLIENT_READ_LIMIT_PER_MINUTE, ttlMs: 60_000 }
const readMeta = meta({ throttle: READ_THROTTLE })
const spawnMeta = meta({ sandboxReachable: true, throttle: READ_THROTTLE })

function assertTokenSpawn({
  ctx,
  agent,
}: {
  ctx: SessionOrSandboxTrpcCtx
  agent: SupervisedAgentInput | undefined
}): void {
  const principal = ctx.sandbox
  if (principal === undefined) return
  if (agent?.spawnedBy !== principal.threadId) {
    throw new ForbiddenException(
      'a sandbox token creates only direct sub-agent threads of its own thread',
    )
  }
}

@Router({ alias: 'threads' })
@UseMiddlewares(SessionOrSandboxMiddleware)
export class ThreadsRouter {
  constructor(
    private readonly threads: ThreadsService,
    private readonly history: ThreadsHistoryService,
    private readonly launcher: ThreadLauncher,
    private readonly archival: ThreadArchiveService,
    private readonly reads: ThreadReadService,
  ) {}

  @Mutation({ input: createThreadInputSchema, output: createThreadOutputSchema, meta: spawnMeta })
  async create(
    @Input() input: CreateThreadInput,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<ThreadDto | ThreadLaunchReply> {
    const viaToken = ctx.sandbox !== undefined || ctx.pod !== undefined
    if (viaToken && input.firstMessage !== undefined) {
      throw new ForbiddenException(
        'a pod or sandbox token cannot start a thread with a first message',
      )
    }
    if (viaToken && input.id !== undefined) {
      throw new ForbiddenException('a pod or sandbox token cannot choose a thread id')
    }
    assertTokenSpawn({ ctx, agent: input.agent })
    const userId = ctx.auth.userId
    if (input.firstMessage === undefined) return this.threads.create({ userId, draft: input })
    return this.launcher.launch({ userId, draft: input, firstMessage: input.firstMessage })
  }

  @Mutation({ input: openThreadInputSchema, output: openThreadReplySchema, meta: spawnMeta })
  async open(
    @Input() input: OpenThreadInput,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<{ thread: ThreadDto; events: EventDto[] }> {
    const principal = ctx.sandbox ?? ctx.pod
    if (principal !== undefined && input.executionLocation !== undefined) {
      throw new ForbiddenException('a pod or sandbox token cannot set an execution location')
    }
    assertTokenSpawn({ ctx, agent: input.agent })
    const { id, ...rest } = input
    return this.threads.open({
      userId: ctx.auth.userId,
      ...(principal === undefined ? {} : { confinedTo: principal.threadId }),
      draft: { ...rest, threadId: id },
    })
  }

  @Query({ input: recentThreadInputSchema, output: wireThreadSchema.nullable(), meta: readMeta })
  recent(
    @Input() input: RecentThreadInput,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<ThreadDto | null> {
    return this.threads.mostRecent({ userId: ctx.auth.userId, project: input.project })
  }

  @Query({ input: listThreadsInputSchema, output: z.array(wireThreadSchema), meta: readMeta })
  list(
    @Input() input: ListThreadsInput,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<ThreadDto[]> {
    return this.threads.list({ userId: ctx.auth.userId, ...input })
  }

  @Query({ input: threadIdInputSchema, output: wireThreadSchema, meta: readMeta })
  get(@Input() input: ThreadIdInput, @Ctx() ctx: SessionOrSandboxTrpcCtx): Promise<ThreadDto> {
    return this.threads.find({ userId: ctx.auth.userId, threadId: input.threadId })
  }

  @Query({ input: threadIdInputSchema, output: z.array(wireThreadSchema), meta: readMeta })
  spawned(
    @Input() input: ThreadIdInput,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<ThreadDto[]> {
    return this.threads.spawned({ userId: ctx.auth.userId, threadId: input.threadId })
  }

  @Mutation({ input: renameThreadInputSchema, output: z.void(), meta: readMeta })
  async rename(
    @Input() input: RenameThreadInput,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<void> {
    await this.threads.rename({ userId: ctx.auth.userId, threadId: input.threadId, draft: input })
  }

  @Mutation({ input: archiveThreadInputSchema, output: z.void(), meta: readMeta })
  async archive(
    @Input() input: ArchiveThreadInput,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<void> {
    await this.archival.setArchived({
      userId: ctx.auth.userId,
      threadId: input.threadId,
      archived: input.archived,
    })
  }

  @Mutation({ input: markThreadReadInputSchema, output: z.void(), meta: readMeta })
  async markRead(
    @Input() input: MarkThreadReadInput,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<void> {
    if (ctx.sandbox !== undefined || ctx.pod !== undefined) {
      throw new ForbiddenException('only the thread owner can mark a thread read')
    }
    await this.reads.markRead({
      userId: ctx.auth.userId,
      threadId: input.threadId,
      seq: input.seq,
    })
  }

  @Mutation({ input: chooseThreadModelInputSchema, output: z.void(), meta: readMeta })
  async chooseModel(
    @Input() input: ChooseThreadModelInput,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<void> {
    await this.threads.chooseModel({
      userId: ctx.auth.userId,
      threadId: input.threadId,
      draft: input,
    })
  }

  @Mutation({ input: adoptThreadInputSchema, output: z.void(), meta: readMeta })
  async adopt(
    @Input() input: AdoptThreadInput,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<void> {
    await this.threads.adopt({ userId: ctx.auth.userId, threadId: input.threadId, draft: input })
  }

  @Mutation({ input: rewindThreadInputSchema, output: z.void(), meta: readMeta })
  async rewind(
    @Input() input: RewindThreadInput,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<void> {
    await this.history.rewind({ userId: ctx.auth.userId, threadId: input.threadId, draft: input })
  }

  @Mutation({ input: compactThreadInputSchema, output: replacedReplySchema, meta: readMeta })
  compact(
    @Input() input: CompactThreadInput,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<ReplacedReply> {
    return this.history.compact({ userId: ctx.auth.userId, threadId: input.threadId, draft: input })
  }

  @Mutation({ input: summariseThreadInputSchema, output: replacedReplySchema, meta: readMeta })
  summarise(
    @Input() input: SummariseThreadInput,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<ReplacedReply> {
    return this.history.summarise({
      userId: ctx.auth.userId,
      threadId: input.threadId,
      draft: input,
    })
  }

  @Mutation({ input: forkThreadInputSchema, output: wireThreadSchema, meta: readMeta })
  fork(@Input() input: ForkThreadInput, @Ctx() ctx: SessionOrSandboxTrpcCtx): Promise<ThreadDto> {
    return this.history.fork({ userId: ctx.auth.userId, threadId: input.threadId, draft: input })
  }
}

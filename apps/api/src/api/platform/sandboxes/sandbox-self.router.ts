import {
  bootStepsPostSchema,
  contextFileDeleteSchema,
  contextFilePutSchema,
  contextFilesDeleteMissingSchema,
  EEventsWatchFrame,
  EThreadStreamFrame,
  eventsWatchInputSchema,
  eventsWatchOutputSchema,
  podChildRegisterSchema,
  podEventsPostSchema,
  podEventsReplySchema,
  podEventsTruncateSchema,
  sandboxActivityPostSchema,
  sandboxExposePortReplySchema,
  sandboxExposePortRequestSchema,
  sandboxDeadlineObservationSchema,
  sandboxSelfRenewDeadlineRequestSchema,
  sandboxSelfStopRequestSchema,
  type BootStepsPost,
  type ContextFileDelete,
  type ContextFilePut,
  type ContextFilesDeleteMissing,
  type EventsWatchFrame,
  type EventsWatchInput,
  type PodChildRegister,
  type PodEventsPost,
  type PodEventsReply,
  type PodEventsTruncate,
  type SandboxActivityPost,
  type SandboxExposePortReply,
  type SandboxExposePortRequest,
  type SandboxDeadlineObservation,
  type SandboxSelfRenewDeadlineRequest,
  type SandboxSelfStopRequest,
} from '@dltech/atlas-wire'
import { db } from '@dltech/atlas-db'
import { NotFoundException } from '@nestjs/common'
import {
  Ctx,
  Input,
  Mutation,
  Options,
  type ProcedureOptions,
  Router,
  Subscription,
  UseMiddlewares,
} from 'nestjs-trpc'
import { z } from 'zod'
import { meta } from '../../../_module/trpc/procedure-meta'
import { podSessionOf } from '../sessions/session-of-thread'
import { lockThread } from '../sessions/thread-head'
import { ThreadSignalsService } from '../sessions/thread-signals.service'
import { threadStreamFrames } from '../sessions/thread-stream.frames'
import { recordBootSteps } from './sandbox-boot-steps'
import { applyThreadActivity } from './thread-activity'
import { registerPodChild } from './pod-child'
import { deleteContextFile, deleteMissingContextFiles, putContextFile } from './pod-context-files'
import { applyPodEvents, truncatePodEvents } from './pod-events'
import { assertWithinSandboxFamily } from './pod-family'
import { SandboxTokenMiddleware, type SandboxTrpcCtx } from './sandbox-token.middleware'
import { PreviewTunnelService } from './preview-tunnel.service'
import { VercelSandboxClient } from './vercel-sandbox.client'

const WATCH_QUEUE_LIMIT = 64
const TICK: EventsWatchFrame = { type: EEventsWatchFrame.Tick }

type SandboxIdentity = { threadId: string; name: string }

async function identityOf(ctx: SandboxTrpcCtx): Promise<SandboxIdentity> {
  const sessionId = await podSessionOf({
    reader: db,
    threadId: ctx.sandbox.threadId,
  })
  const row = await db.orm.public.CloudSandbox.where({ sessionId }).select('name').first()
  if (row === null) throw new NotFoundException('sandbox not found')
  return { threadId: ctx.sandbox.threadId, name: row.name }
}

@Router({ alias: 'sandboxSelf' })
@UseMiddlewares(SandboxTokenMiddleware)
export class SandboxSelfRouter {
  constructor(
    private readonly vercel: VercelSandboxClient,
    private readonly previews: PreviewTunnelService,
    private readonly signals: ThreadSignalsService,
  ) {}

  @Mutation({
    input: sandboxExposePortRequestSchema,
    output: sandboxExposePortReplySchema,
    meta: meta({ podReachable: true }),
  })
  async exposePort(
    @Input() input: SandboxExposePortRequest,
    @Ctx() ctx: SandboxTrpcCtx,
  ): Promise<SandboxExposePortReply> {
    return this.previews.expose({ ...ctx.sandbox, port: input.port })
  }

  @Mutation({ input: sandboxSelfStopRequestSchema, output: z.void() })
  async stop(@Input() input: SandboxSelfStopRequest, @Ctx() ctx: SandboxTrpcCtx): Promise<void> {
    const sandbox = await identityOf(ctx)
    await this.vercel.stopSession({ ...sandbox, sessionId: input.sessionId })
  }

  @Mutation({
    input: sandboxSelfRenewDeadlineRequestSchema,
    output: sandboxDeadlineObservationSchema,
  })
  async renewDeadline(
    @Input() input: SandboxSelfRenewDeadlineRequest,
    @Ctx() ctx: SandboxTrpcCtx,
  ): Promise<SandboxDeadlineObservation> {
    const sandbox = await identityOf(ctx)
    return this.vercel.renewDeadline({
      ...sandbox,
      sessionId: input.sessionId,
      until: input.until,
    })
  }

  @Mutation({ input: bootStepsPostSchema, output: z.void() })
  async bootSteps(@Input() input: BootStepsPost, @Ctx() ctx: SandboxTrpcCtx): Promise<void> {
    const { threadId } = ctx.sandbox
    await db.transaction(async (tx) => {
      await lockThread({ tx, threadId })
      await recordBootSteps({ writer: tx, threadId, steps: input.steps })
    })
    await this.signals.podChanged({ threadId })
  }

  @Mutation({ input: podEventsPostSchema, output: podEventsReplySchema })
  async events(@Input() input: PodEventsPost, @Ctx() ctx: SandboxTrpcCtx): Promise<PodEventsReply> {
    const threadId = await assertWithinSandboxFamily({
      rootThreadId: ctx.sandbox.threadId,
      userId: ctx.sandbox.userId,
      threadId: input.threadId,
    })
    return applyPodEvents({
      threadId,
      events: input.events,
      signals: this.signals,
    })
  }

  @Mutation({ input: podEventsTruncateSchema, output: podEventsReplySchema })
  async truncateEvents(
    @Input() input: PodEventsTruncate,
    @Ctx() ctx: SandboxTrpcCtx,
  ): Promise<PodEventsReply> {
    const threadId = await assertWithinSandboxFamily({
      rootThreadId: ctx.sandbox.threadId,
      userId: ctx.sandbox.userId,
      threadId: input.threadId,
    })
    return truncatePodEvents({
      threadId,
      toSeq: input.toSeq,
      signals: this.signals,
    })
  }

  @Mutation({ input: contextFilePutSchema, output: z.void() })
  async putContextFile(@Input() input: ContextFilePut, @Ctx() ctx: SandboxTrpcCtx): Promise<void> {
    const threadId = await assertWithinSandboxFamily({
      rootThreadId: ctx.sandbox.threadId,
      userId: ctx.sandbox.userId,
      threadId: input.threadId,
    })
    await putContextFile({ threadId, path: input.path, content: input.content })
  }

  @Mutation({ input: contextFileDeleteSchema, output: z.void() })
  async deleteContextFile(
    @Input() input: ContextFileDelete,
    @Ctx() ctx: SandboxTrpcCtx,
  ): Promise<void> {
    const threadId = await assertWithinSandboxFamily({
      rootThreadId: ctx.sandbox.threadId,
      userId: ctx.sandbox.userId,
      threadId: input.threadId,
    })
    await deleteContextFile({ threadId, path: input.path })
  }

  @Mutation({ input: contextFilesDeleteMissingSchema, output: z.void() })
  async deleteMissingContextFiles(
    @Input() input: ContextFilesDeleteMissing,
    @Ctx() ctx: SandboxTrpcCtx,
  ): Promise<void> {
    const threadId = await assertWithinSandboxFamily({
      rootThreadId: ctx.sandbox.threadId,
      userId: ctx.sandbox.userId,
      threadId: input.threadId,
    })
    await deleteMissingContextFiles({ threadId, keep: input.keep })
  }

  @Mutation({ input: podChildRegisterSchema, output: podEventsReplySchema })
  registerChild(
    @Input() input: PodChildRegister,
    @Ctx() ctx: SandboxTrpcCtx,
  ): Promise<PodEventsReply> {
    return registerPodChild({
      rootThreadId: ctx.sandbox.threadId,
      userId: ctx.sandbox.userId,
      input,
      signals: this.signals,
    })
  }

  @Mutation({
    input: sandboxActivityPostSchema,
    output: z.void(),
    meta: meta({ podReachable: true }),
  })
  async activity(@Input() input: SandboxActivityPost, @Ctx() ctx: SandboxTrpcCtx): Promise<void> {
    const { threadId: requested, ...activity } = input
    const threadId = await assertWithinSandboxFamily({
      rootThreadId: ctx.sandbox.threadId,
      userId: ctx.sandbox.userId,
      threadId: requested,
    })
    const applied = await applyThreadActivity({ threadId, activity })
    if (applied !== null) this.signals.threadChanged({ threadId })
  }

  @Subscription({ input: eventsWatchInputSchema, output: eventsWatchOutputSchema })
  async watchEvents(
    @Input() input: EventsWatchInput,
    @Ctx() ctx: SandboxTrpcCtx,
    @Options() opts: ProcedureOptions,
  ): Promise<AsyncGenerator<EventsWatchFrame>> {
    const threadId = await assertWithinSandboxFamily({
      rootThreadId: ctx.sandbox.threadId,
      userId: ctx.sandbox.userId,
      threadId: input.threadId,
    })
    return threadStreamFrames<EventsWatchFrame>({
      signal: opts.signal,
      queueLimit: WATCH_QUEUE_LIMIT,
      attach: (sink) => {
        sink.push(TICK)
        return this.signals.openStream({
          threadId,
          onFrame: (frame) => {
            if (
              frame.type === EThreadStreamFrame.Events ||
              frame.type === EThreadStreamFrame.Head ||
              frame.type === EThreadStreamFrame.Heartbeat
            )
              sink.push(TICK)
          },
          onClosed: sink.close,
        })
      },
    })
  }
}

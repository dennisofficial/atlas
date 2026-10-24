import {
  bootStepsPostSchema,
  podEventsPostSchema,
  podEventsReplySchema,
  podEventsTruncateSchema,
  sandboxExposePortReplySchema,
  sandboxExposePortRequestSchema,
  sandboxSelfStopRequestSchema,
  type BootStepsPost,
  type PodEventsPost,
  type PodEventsReply,
  type PodEventsTruncate,
  type SandboxExposePortReply,
  type SandboxExposePortRequest,
  type SandboxSelfStopRequest,
} from '@dltech/atlas-wire'
import { db } from '@dltech/atlas-db'
import { NotFoundException } from '@nestjs/common'
import { Ctx, Input, Mutation, Router, UseMiddlewares } from 'nestjs-trpc'
import { z } from 'zod'
import { meta } from '../../../_module/trpc/procedure-meta'
import { lockThread } from '../sessions/thread-head'
import { recordBootSteps } from './sandbox-boot-steps'
import { applyPodEvents, truncatePodEvents } from './pod-events'
import { SandboxTokenMiddleware, type SandboxTrpcCtx } from './sandbox-token.middleware'
import { VercelSandboxClient } from './vercel-sandbox.client'

type SandboxIdentity = { threadId: string; name: string }

async function identityOf(ctx: SandboxTrpcCtx): Promise<SandboxIdentity> {
  const row = await db.orm.public.CloudSandbox.where({ threadId: ctx.sandbox.threadId })
    .select('threadId', 'name')
    .first()
  if (row === null) throw new NotFoundException('sandbox not found')
  return row
}

@Router({ alias: 'sandboxSelf' })
@UseMiddlewares(SandboxTokenMiddleware)
export class SandboxSelfRouter {
  constructor(private readonly vercel: VercelSandboxClient) {}

  @Mutation({
    input: sandboxExposePortRequestSchema,
    output: sandboxExposePortReplySchema,
  })
  async exposePort(
    @Input() input: SandboxExposePortRequest,
    @Ctx() ctx: SandboxTrpcCtx,
  ): Promise<SandboxExposePortReply> {
    const sandbox = await identityOf(ctx)
    const url = await this.vercel.exposePort({ ...sandbox, port: input.port })
    return { url }
  }

  @Mutation({ input: sandboxSelfStopRequestSchema, output: z.void() })
  async stop(@Input() input: SandboxSelfStopRequest, @Ctx() ctx: SandboxTrpcCtx): Promise<void> {
    const sandbox = await identityOf(ctx)
    await this.vercel.stopSession({ ...sandbox, sessionId: input.sessionId })
  }

  @Mutation({ input: bootStepsPostSchema, output: z.void() })
  async bootSteps(@Input() input: BootStepsPost, @Ctx() ctx: SandboxTrpcCtx): Promise<void> {
    const { threadId } = ctx.sandbox
    await db.transaction(async (tx) => {
      await lockThread({ tx, threadId })
      await recordBootSteps({ writer: tx, threadId, steps: input.steps })
    })
  }

  @Mutation({
    input: podEventsPostSchema,
    output: podEventsReplySchema,
    meta: meta({ podReachable: true }),
  })
  events(@Input() input: PodEventsPost, @Ctx() ctx: SandboxTrpcCtx): Promise<PodEventsReply> {
    return applyPodEvents({ threadId: ctx.sandbox.threadId, events: input.events })
  }

  @Mutation({
    input: podEventsTruncateSchema,
    output: podEventsReplySchema,
    meta: meta({ podReachable: true }),
  })
  truncateEvents(
    @Input() input: PodEventsTruncate,
    @Ctx() ctx: SandboxTrpcCtx,
  ): Promise<PodEventsReply> {
    return truncatePodEvents({ threadId: ctx.sandbox.threadId, toSeq: input.toSeq })
  }
}

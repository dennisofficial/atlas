import {
  appendEventsInputSchema,
  importEventsInputSchema,
  podEventsReplySchema,
  readEventsInputSchema,
  replaceEventsInputSchema,
  threadHeadReplySchema,
  threadIdInputSchema,
  wireEventSchema,
  type AppendEventsInput,
  type ImportEventsInput,
  type PodEventsReply,
  type ReadEventsInput,
  type ReplaceEventsInput,
  type ThreadHeadReply,
  type ThreadIdInput,
} from '@dltech/atlas-wire'
import { ForbiddenException } from '@nestjs/common'
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { z } from 'zod'
import { meta } from '../../../_module/trpc/procedure-meta'
import { CLIENT_READ_LIMIT_PER_MINUTE } from '../../client-rate-limit'
import { EventsService } from './events.service'
import {
  SessionOrSandboxMiddleware,
  type SessionOrSandboxTrpcCtx,
} from './session-or-sandbox.middleware'
import type { EventDto } from './sessions.types'

const readMeta = meta({ throttle: { limit: CLIENT_READ_LIMIT_PER_MINUTE, ttlMs: 60_000 } })
const unthrottledMeta = meta({ throttle: false })

@Router({ alias: 'threadEvents' })
@UseMiddlewares(SessionOrSandboxMiddleware)
export class ThreadEventsRouter {
  constructor(private readonly events: EventsService) {}

  @Mutation({
    input: appendEventsInputSchema,
    output: z.array(wireEventSchema),
    meta: readMeta,
  })
  append(
    @Input() input: AppendEventsInput,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<EventDto[]> {
    return this.events.append({ userId: ctx.auth.userId, threadId: input.threadId, draft: input })
  }

  @Mutation({
    input: replaceEventsInputSchema,
    output: z.array(wireEventSchema),
    meta: readMeta,
  })
  replace(
    @Input() input: ReplaceEventsInput,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<EventDto[]> {
    return this.events.replace({ userId: ctx.auth.userId, threadId: input.threadId, draft: input })
  }

  @Query({
    input: readEventsInputSchema,
    output: z.array(wireEventSchema),
    meta: unthrottledMeta,
  })
  read(@Input() input: ReadEventsInput, @Ctx() ctx: SessionOrSandboxTrpcCtx): Promise<EventDto[]> {
    const args = { userId: ctx.auth.userId, threadId: input.threadId, upTo: input.upTo }
    if (input.own === true) return this.events.readOwn(args)
    return this.events.read(args)
  }

  @Mutation({ input: importEventsInputSchema, output: podEventsReplySchema, meta: readMeta })
  async import(
    @Input() input: ImportEventsInput,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<PodEventsReply> {
    if (ctx.sandbox !== undefined || ctx.pod !== undefined) {
      throw new ForbiddenException('only the thread owner can import events')
    }
    return this.events.importEvents({
      userId: ctx.auth.userId,
      threadId: input.threadId,
      events: input.events,
    })
  }

  @Query({ input: threadIdInputSchema, output: threadHeadReplySchema, meta: readMeta })
  head(
    @Input() input: ThreadIdInput,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<ThreadHeadReply> {
    return this.events.head({ userId: ctx.auth.userId, threadId: input.threadId })
  }
}

import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import {
  v2SessionCreateInputSchema,
  v2SessionCreateOutputSchema,
  v2SessionEventsInputSchema,
  v2SessionEventsOutputSchema,
  v2SessionListInputSchema,
  v2SessionListOutputSchema,
  v2SessionPostInputSchema,
  v2SessionPostOutputSchema,
  v2SessionStatusInputSchema,
  v2SessionStatusOutputSchema,
  type V2SessionCreateInput,
  type V2SessionCreateOutput,
  type V2SessionEventsInput,
  type V2SessionEventsOutput,
  type V2SessionListInput,
  type V2SessionListOutput,
  type V2SessionPostInput,
  type V2SessionPostOutput,
  type V2SessionStatusInput,
  type V2SessionStatusOutput,
} from '@dltech/atlas-protocol'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { V2SessionsService } from './v2-sessions.service'
import { V2UserMiddleware } from './v2-user.middleware'

@Router({ alias: 'v2Sessions' })
@UseMiddlewares(SessionMiddleware, V2UserMiddleware)
export class V2SessionsRouter {
  constructor(private readonly sessions: V2SessionsService) {}

  @Mutation({ input: v2SessionCreateInputSchema, output: v2SessionCreateOutputSchema })
  create(
    @Input() input: V2SessionCreateInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<V2SessionCreateOutput> {
    return this.sessions.create({ userId: ctx.auth.userId, ...input })
  }

  @Query({ input: v2SessionListInputSchema, output: v2SessionListOutputSchema })
  list(
    @Input() input: V2SessionListInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<V2SessionListOutput> {
    return this.sessions.list({ userId: ctx.auth.userId, ...input })
  }

  @Mutation({ input: v2SessionPostInputSchema, output: v2SessionPostOutputSchema })
  post(
    @Input() input: V2SessionPostInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<V2SessionPostOutput> {
    return this.sessions.post({ userId: ctx.auth.userId, ...input })
  }

  @Query({ input: v2SessionEventsInputSchema, output: v2SessionEventsOutputSchema })
  events(
    @Input() input: V2SessionEventsInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<V2SessionEventsOutput> {
    return this.sessions.events({ userId: ctx.auth.userId, ...input })
  }

  @Query({ input: v2SessionStatusInputSchema, output: v2SessionStatusOutputSchema })
  status(
    @Input() input: V2SessionStatusInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<V2SessionStatusOutput> {
    return this.sessions.status({ userId: ctx.auth.userId, sessionId: input.sessionId })
  }
}

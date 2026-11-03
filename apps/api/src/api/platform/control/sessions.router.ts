import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import {
  sessionCreateInputSchema,
  sessionCreateOutputSchema,
  sessionEventsInputSchema,
  sessionEventsOutputSchema,
  sessionListInputSchema,
  sessionListOutputSchema,
  sessionPostInputSchema,
  sessionPostOutputSchema,
  sessionStatusInputSchema,
  sessionStatusOutputSchema,
  type SessionCreateInput,
  type SessionCreateOutput,
  type SessionEventsInput,
  type SessionEventsOutput,
  type SessionListInput,
  type SessionListOutput,
  type SessionPostInput,
  type SessionPostOutput,
  type SessionStatusInput,
  type SessionStatusOutput,
} from '@dltech/atlas-protocol'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { SessionsService } from './sessions.service'

@Router({ alias: 'sessions' })
@UseMiddlewares(SessionMiddleware)
export class SessionsRouter {
  constructor(private readonly sessions: SessionsService) {}

  @Mutation({ input: sessionCreateInputSchema, output: sessionCreateOutputSchema })
  create(
    @Input() input: SessionCreateInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<SessionCreateOutput> {
    return this.sessions.create({ userId: ctx.auth.userId, ...input })
  }

  @Query({ input: sessionListInputSchema, output: sessionListOutputSchema })
  list(@Input() input: SessionListInput, @Ctx() ctx: SessionTrpcCtx): Promise<SessionListOutput> {
    return this.sessions.list({ userId: ctx.auth.userId, ...input })
  }

  @Mutation({ input: sessionPostInputSchema, output: sessionPostOutputSchema })
  post(@Input() input: SessionPostInput, @Ctx() ctx: SessionTrpcCtx): Promise<SessionPostOutput> {
    return this.sessions.post({ userId: ctx.auth.userId, ...input })
  }

  @Query({ input: sessionEventsInputSchema, output: sessionEventsOutputSchema })
  events(
    @Input() input: SessionEventsInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<SessionEventsOutput> {
    return this.sessions.events({ userId: ctx.auth.userId, ...input })
  }

  @Query({ input: sessionStatusInputSchema, output: sessionStatusOutputSchema })
  status(
    @Input() input: SessionStatusInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<SessionStatusOutput> {
    return this.sessions.status({ userId: ctx.auth.userId, sessionId: input.sessionId })
  }
}

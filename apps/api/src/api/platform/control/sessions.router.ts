import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { TRPCError } from '@trpc/server'
import {
  sessionBlobInputSchema,
  sessionBlobOutputSchema,
  sessionCreateInputSchema,
  sessionCreateOutputSchema,
  sessionEventsInputSchema,
  sessionEventsOutputSchema,
  sessionListInputSchema,
  sessionListOutputSchema,
  sessionPostInputSchema,
  sessionPostOutputSchema,
  sessionRepairDiagramInputSchema,
  sessionStatusInputSchema,
  sessionStatusOutputSchema,
  type SessionBlobInput,
  type SessionBlobOutput,
  type SessionCreateInput,
  type SessionCreateOutput,
  type SessionEventsInput,
  type SessionEventsOutput,
  type SessionListInput,
  type SessionListOutput,
  type SessionPostInput,
  type SessionPostOutput,
  type SessionRepairDiagramInput,
  type SessionStatusInput,
  type SessionStatusOutput,
} from '@dltech/atlas-protocol'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { SessionsService } from './sessions.service'

@Router({ alias: 'sessions' })
@UseMiddlewares(SessionMiddleware)
export class SessionsRouter {
  constructor(private readonly sessions: SessionsService) {}

  private refuseBatched(ctx: SessionTrpcCtx): void {
    if (ctx.req.query.batch === '1') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'batched calls are not supported' })
    }
  }

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

  @Mutation({ input: sessionRepairDiagramInputSchema, output: sessionPostOutputSchema })
  repairDiagram(
    @Input() input: SessionRepairDiagramInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<SessionPostOutput> {
    return this.sessions.repairDiagram({ userId: ctx.auth.userId, ...input })
  }

  @Query({ input: sessionEventsInputSchema, output: sessionEventsOutputSchema })
  events(
    @Input() input: SessionEventsInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<SessionEventsOutput> {
    this.refuseBatched(ctx)
    return this.sessions.events({ userId: ctx.auth.userId, ...input })
  }

  @Query({ input: sessionBlobInputSchema, output: sessionBlobOutputSchema })
  blob(@Input() input: SessionBlobInput, @Ctx() ctx: SessionTrpcCtx): Promise<SessionBlobOutput> {
    this.refuseBatched(ctx)
    return this.sessions.blob({ userId: ctx.auth.userId, ...input })
  }

  @Query({ input: sessionStatusInputSchema, output: sessionStatusOutputSchema })
  status(
    @Input() input: SessionStatusInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<SessionStatusOutput> {
    return this.sessions.status({ userId: ctx.auth.userId, sessionId: input.sessionId })
  }
}

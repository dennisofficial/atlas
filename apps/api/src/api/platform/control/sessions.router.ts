import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { TRPCError } from '@trpc/server'
import {
  sessionArchiveInputSchema,
  sessionArchiveOutputSchema,
  sessionBlobInputSchema,
  sessionBlobOutputSchema,
  sessionCommandInputSchema,
  sessionCommandOutputSchema,
  sessionCreateInputSchema,
  sessionCreateOutputSchema,
  sessionEventsInputSchema,
  sessionEventsOutputSchema,
  sessionListInputSchema,
  sessionListOutputSchema,
  sessionPostInputSchema,
  sessionPostOutputSchema,
  sessionRetryInputSchema,
  sessionRetryOutputSchema,
  sessionViewInputSchema,
  sessionViewOutputSchema,
  sessionStatusInputSchema,
  sessionStatusOutputSchema,
  sessionWithdrawInputSchema,
  sessionWithdrawOutputSchema,
  type SessionArchiveInput,
  type SessionArchiveOutput,
  type SessionBlobInput,
  type SessionBlobOutput,
  type SessionCommandInput,
  type SessionCommandOutput,
  type SessionCreateInput,
  type SessionCreateOutput,
  type SessionEventsInput,
  type SessionEventsOutput,
  type SessionListInput,
  type SessionListOutput,
  type SessionPostInput,
  type SessionPostOutput,
  type SessionRetryInput,
  type SessionRetryOutput,
  type SessionViewInput,
  type SessionViewOutput,
  type SessionStatusInput,
  type SessionStatusOutput,
  type SessionWithdrawInput,
  type SessionWithdrawOutput,
} from '@dltech/atlas-protocol'
import {
  sessionPageInputSchema,
  sessionPageOutputSchema,
  type SessionPageInput,
  type SessionPageOutput,
} from '@dltech/atlas-wire'
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

  @Mutation({ input: sessionWithdrawInputSchema, output: sessionWithdrawOutputSchema })
  withdraw(
    @Input() input: SessionWithdrawInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<SessionWithdrawOutput> {
    return this.sessions.withdraw({ userId: ctx.auth.userId, ...input })
  }

  @Mutation({ input: sessionArchiveInputSchema, output: sessionArchiveOutputSchema })
  archive(
    @Input() input: SessionArchiveInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<SessionArchiveOutput> {
    return this.sessions.archive({ userId: ctx.auth.userId, ...input })
  }

  @Query({ input: sessionPageInputSchema, output: sessionPageOutputSchema })
  page(@Input() input: SessionPageInput, @Ctx() ctx: SessionTrpcCtx): Promise<SessionPageOutput> {
    return this.sessions.page({ userId: ctx.auth.userId, ...input })
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

  @Mutation({ input: sessionRetryInputSchema, output: sessionRetryOutputSchema })
  retry(
    @Input() input: SessionRetryInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<SessionRetryOutput> {
    return this.sessions.retry({ userId: ctx.auth.userId, sessionId: input.sessionId })
  }

  @Mutation({ input: sessionCommandInputSchema, output: sessionCommandOutputSchema })
  command(
    @Input() input: SessionCommandInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<SessionCommandOutput> {
    return this.sessions.command({ userId: ctx.auth.userId, ...input })
  }

  @Query({ input: sessionViewInputSchema, output: sessionViewOutputSchema })
  view(@Input() input: SessionViewInput, @Ctx() ctx: SessionTrpcCtx): Promise<SessionViewOutput> {
    return this.sessions.view({ userId: ctx.auth.userId, sessionId: input.sessionId })
  }
}

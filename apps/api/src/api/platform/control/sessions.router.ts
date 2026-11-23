import {
  type ProcedureOptions,
  Ctx,
  Input,
  Mutation,
  Options,
  Query,
  Router,
  Subscription,
  UseMiddlewares,
} from 'nestjs-trpc'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import {
  sessionArchiveInputSchema,
  sessionArchiveOutputSchema,
  sessionBlobInputSchema,
  sessionBucketPageInputSchema,
  sessionBucketPageOutputSchema,
  sessionChangeContentInputSchema,
  sessionChangeContentOutputSchema,
  sessionChangesInputSchema,
  sessionChangesOutputSchema,
  sessionBlobOutputSchema,
  sessionCommandInputSchema,
  sessionCommandOutputSchema,
  sessionCommandsOutputSchema,
  sessionCreateInputSchema,
  sessionCreateOutputSchema,
  sessionEventsInputSchema,
  sessionEventsOutputSchema,
  sessionHoldPodInputSchema,
  sessionHoldPodOutputSchema,
  sessionListInputSchema,
  sessionListOutputSchema,
  sessionMarkReadInputSchema,
  sessionMarkReadOutputSchema,
  sessionPostInputSchema,
  sessionPostOutputSchema,
  sessionRetryInputSchema,
  sessionRetryOutputSchema,
  sessionSleepPodInputSchema,
  sessionSleepPodOutputSchema,
  sessionViewInputSchema,
  sessionWakeInputSchema,
  sessionWakeOutputSchema,
  sessionViewOutputSchema,
  sessionPodMetricsInputSchema,
  podMetricsStreamOutputSchema,
  type PodMetricsFrame,
  type SessionPodMetricsInput,
  sessionStatusInputSchema,
  sessionStatusOutputSchema,
  sessionStopInputSchema,
  sessionStopOutputSchema,
  sessionSubscribeInputSchema,
  sessionSubscribeOutputSchema,
  sessionUnsubscribeInputSchema,
  sessionUnsubscribeOutputSchema,
  sessionWithdrawInputSchema,
  sessionWithdrawOutputSchema,
  type SessionArchiveInput,
  type SessionArchiveOutput,
  type SessionBlobInput,
  type SessionBucketPageInput,
  type SessionBucketPageOutput,
  type SessionChangeContentInput,
  type SessionChangeContentOutput,
  type SessionChangesInput,
  type SessionChangesOutput,
  type SessionBlobOutput,
  type SessionCommandInput,
  type SessionCommandOutput,
  type SessionCommandsOutput,
  type SessionCreateInput,
  type SessionCreateOutput,
  type SessionEventsInput,
  type SessionEventsOutput,
  type SessionHoldPodInput,
  type SessionHoldPodOutput,
  type SessionListInput,
  type SessionListOutput,
  type SessionMarkReadInput,
  type SessionMarkReadOutput,
  type SessionPostInput,
  type SessionPostOutput,
  type SessionRetryInput,
  type SessionRetryOutput,
  type SessionSleepPodInput,
  type SessionSleepPodOutput,
  type SessionViewInput,
  type SessionViewOutput,
  type SessionWakeInput,
  type SessionWakeOutput,
  type SessionStatusInput,
  type SessionStatusOutput,
  type SessionStopInput,
  type SessionStopOutput,
  type SessionSubscribeInput,
  type SessionSubscribeOutput,
  type SessionUnsubscribeInput,
  type SessionUnsubscribeOutput,
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
import { ChangesService } from './changes.service'
import { commandCatalogue } from './command-registry'
import { PodMetricsService } from './pod-metrics.service'
import { SessionsService } from './sessions.service'

@Router({ alias: 'sessions' })
@UseMiddlewares(SessionMiddleware)
export class SessionsRouter {
  constructor(
    private readonly sessions: SessionsService,
    private readonly changesService: ChangesService,
    private readonly metrics: PodMetricsService,
  ) {}

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

  @Mutation({ input: sessionMarkReadInputSchema, output: sessionMarkReadOutputSchema })
  markRead(
    @Input() input: SessionMarkReadInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<SessionMarkReadOutput> {
    return this.sessions.markRead({ userId: ctx.auth.userId, ...input })
  }

  @Query({ input: sessionPageInputSchema, output: sessionPageOutputSchema })
  page(@Input() input: SessionPageInput, @Ctx() ctx: SessionTrpcCtx): Promise<SessionPageOutput> {
    return this.sessions.page({ userId: ctx.auth.userId, ...input })
  }

  @Query({ input: sessionBucketPageInputSchema, output: sessionBucketPageOutputSchema })
  bucketPage(
    @Input() input: SessionBucketPageInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<SessionBucketPageOutput> {
    return this.sessions.bucketPage({ userId: ctx.auth.userId, ...input })
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

  @Mutation({ input: sessionStopInputSchema, output: sessionStopOutputSchema })
  stop(@Input() input: SessionStopInput, @Ctx() ctx: SessionTrpcCtx): Promise<SessionStopOutput> {
    return this.sessions.stop({ userId: ctx.auth.userId, sessionId: input.sessionId })
  }

  @Mutation({ input: sessionCommandInputSchema, output: sessionCommandOutputSchema })
  command(
    @Input() input: SessionCommandInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<SessionCommandOutput> {
    return this.sessions.command({ userId: ctx.auth.userId, ...input })
  }

  @Query({ input: z.strictObject({}), output: sessionCommandsOutputSchema })
  commands(): SessionCommandsOutput {
    return { commands: [...commandCatalogue()] }
  }

  @Mutation({ input: sessionSubscribeInputSchema, output: sessionSubscribeOutputSchema })
  subscribe(
    @Input() input: SessionSubscribeInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<SessionSubscribeOutput> {
    return this.sessions.subscribe({ userId: ctx.auth.userId, ...input })
  }

  @Mutation({ input: sessionUnsubscribeInputSchema, output: sessionUnsubscribeOutputSchema })
  unsubscribe(
    @Input() input: SessionUnsubscribeInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<SessionUnsubscribeOutput> {
    return this.sessions.unsubscribe({ userId: ctx.auth.userId, ...input })
  }

  @Query({ input: sessionChangesInputSchema, output: sessionChangesOutputSchema })
  changes(
    @Input() input: SessionChangesInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<SessionChangesOutput> {
    return this.changesService.changes({ userId: ctx.auth.userId, ...input })
  }

  @Query({ input: sessionChangeContentInputSchema, output: sessionChangeContentOutputSchema })
  changeContent(
    @Input() input: SessionChangeContentInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<SessionChangeContentOutput> {
    return this.changesService.content({ userId: ctx.auth.userId, ...input })
  }

  @Mutation({ input: sessionWakeInputSchema, output: sessionWakeOutputSchema })
  wake(@Input() input: SessionWakeInput, @Ctx() ctx: SessionTrpcCtx): Promise<SessionWakeOutput> {
    this.refuseBatched(ctx)
    return this.sessions.wake({ userId: ctx.auth.userId, sessionId: input.sessionId })
  }

  @Mutation({ input: sessionSleepPodInputSchema, output: sessionSleepPodOutputSchema })
  sleepPod(
    @Input() input: SessionSleepPodInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<SessionSleepPodOutput> {
    this.refuseBatched(ctx)
    return this.sessions.sleepPod({ userId: ctx.auth.userId, ...input })
  }

  @Mutation({ input: sessionWakeInputSchema, output: sessionWakeOutputSchema })
  wakePod(
    @Input() input: SessionWakeInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<SessionWakeOutput> {
    this.refuseBatched(ctx)
    return this.sessions.wakePod({ userId: ctx.auth.userId, sessionId: input.sessionId })
  }

  @Mutation({ input: sessionHoldPodInputSchema, output: sessionHoldPodOutputSchema })
  holdPod(
    @Input() input: SessionHoldPodInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<SessionHoldPodOutput> {
    this.refuseBatched(ctx)
    return this.sessions.holdPod({ userId: ctx.auth.userId, sessionId: input.sessionId })
  }

  @Query({ input: sessionViewInputSchema, output: sessionViewOutputSchema })
  view(@Input() input: SessionViewInput, @Ctx() ctx: SessionTrpcCtx): Promise<SessionViewOutput> {
    return this.sessions.view({ userId: ctx.auth.userId, sessionId: input.sessionId })
  }

  @Subscription({ input: sessionPodMetricsInputSchema, output: podMetricsStreamOutputSchema })
  podMetrics(
    @Input() input: SessionPodMetricsInput,
    @Ctx() ctx: SessionTrpcCtx,
    @Options() opts: ProcedureOptions,
  ): AsyncGenerator<PodMetricsFrame> {
    return this.metrics.watch({
      userId: ctx.auth.userId,
      sessionId: input.sessionId,
      signal: opts.signal,
    })
  }
}

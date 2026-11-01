import {
  EGithubPrStreamFrame,
  EGithubWakeFrame,
  githubPrAckEventsInputSchema,
  githubPrAckEventsOutputSchema,
  type GithubPrAckEventsInput,
  githubPrStatesOutputSchema,
  githubPrStatesInputSchema,
  type GithubPrStatesInput,
  githubPrStreamOutputSchema,
  githubWakeStreamOutputSchema,
  type GithubPrStatesFrame,
  type GithubPrStreamFrame,
  type GithubWakeFrame,
} from '@dltech/atlas-wire'
import { Logger, ServiceUnavailableException } from '@nestjs/common'
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
import { meta } from '../../../_module/trpc/procedure-meta'
import { DrainStateService } from '../../platform/health/drain-state.service'
import {
  SessionOrSandboxMiddleware,
  type SessionOrSandboxTrpcCtx,
} from '../../platform/sessions/session-or-sandbox.middleware'
import { GithubPrEventMailboxService } from './github-pr-event-mailbox.service'
import { type PrFrameSink, prStreamFrames } from './github-pr-stream.frames'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import { GithubSubscriptionsService } from './github-subscriptions.service'
import { GithubObservationStore } from './github-observation.store'
import { attachObservedStates } from './github-observation.stream'

export const PR_STREAM_HEARTBEAT_INTERVAL_MS = 30_000

@Router({ alias: 'githubPrs' })
@UseMiddlewares(SessionOrSandboxMiddleware)
export class GithubPrStreamRouter {
  private readonly logger = new Logger(GithubPrStreamRouter.name)

  constructor(
    private readonly fanout: GithubPrFanoutService,
    private readonly subscriptions: GithubSubscriptionsService,
    private readonly drain: DrainStateService,
    private readonly mailbox: GithubPrEventMailboxService,
    private readonly observations: GithubObservationStore,
  ) {}

  @Subscription({
    output: githubPrStreamOutputSchema,
    meta: meta({ podReachable: true, sandboxReachable: true }),
  })
  stream(
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
    @Options() opts: ProcedureOptions,
  ): AsyncGenerator<GithubPrStreamFrame> {
    if (this.drain.isDraining()) {
      throw new ServiceUnavailableException('the api is restarting — retry the stream')
    }
    const userId = ctx.auth.userId
    const threadId = ctx.pod?.threadId ?? ctx.sandbox?.threadId
    return prStreamFrames({
      signal: opts.signal,
      attach: (sink) => this.attach({ sink, userId, threadId }),
    })
  }

  @Subscription({ output: githubWakeStreamOutputSchema })
  wakes(
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
    @Options() opts: ProcedureOptions,
  ): AsyncGenerator<GithubWakeFrame> {
    if (this.drain.isDraining()) {
      throw new ServiceUnavailableException('the api is restarting — retry the stream')
    }
    const userId = ctx.auth.userId
    return prStreamFrames<GithubWakeFrame>({
      signal: opts.signal,
      attach: (sink) => {
        sink.push({ type: EGithubWakeFrame.Heartbeat })
        const close = this.fanout.openStream({
          userId,
          handler: () => undefined,
          wakeHandler: (threadId) => sink.push({ type: EGithubWakeFrame.Wake, threadId }),
          onClosed: () => sink.close(),
        })
        const heartbeat = setInterval(() => {
          sink.push({ type: EGithubWakeFrame.Heartbeat })
        }, PR_STREAM_HEARTBEAT_INTERVAL_MS)
        return () => {
          clearInterval(heartbeat)
          close()
        }
      },
    })
  }

  @Mutation({
    input: githubPrAckEventsInputSchema,
    output: githubPrAckEventsOutputSchema,
  })
  async ackEvents(
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
    @Input() input: GithubPrAckEventsInput,
  ): Promise<{ acked: number }> {
    const threadId = ctx.pod?.threadId ?? ctx.sandbox?.threadId ?? input.threadId
    const acked = await this.mailbox.acknowledge({ threadId, eventIds: input.eventIds })
    return { acked }
  }

  @Subscription({ input: githubPrStatesInputSchema, output: githubPrStatesOutputSchema })
  states(
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
    @Options() opts: ProcedureOptions,
    @Input() input?: GithubPrStatesInput,
  ): AsyncGenerator<GithubPrStatesFrame> {
    if (this.drain.isDraining()) {
      throw new ServiceUnavailableException('the api is restarting — retry the stream')
    }
    const userId = ctx.auth.userId
    return prStreamFrames<GithubPrStatesFrame>({
      signal: opts.signal,
      attach: (sink) =>
        attachObservedStates({
          userId,
          signal: opts.signal,
          observe: input?.observe ?? [],
          sink,
          observations: this.observations,
          subscriptions: this.subscriptions,
          fanout: this.fanout,
          logger: this.logger,
        }),
    })
  }

  private attach(args: {
    sink: PrFrameSink
    userId: string
    threadId: string | undefined
  }): () => void {
    args.sink.push({ type: EGithubPrStreamFrame.Heartbeat })
    void this.replayKnownStates(args)
    void this.replayMailbox(args)
    const close = this.fanout.openStream({
      userId: args.userId,
      ...(args.threadId === undefined ? {} : { threadId: args.threadId }),
      handler: (state) => args.sink.push({ type: EGithubPrStreamFrame.PrState, state }),
      eventHandler: (event) => args.sink.push({ type: EGithubPrStreamFrame.PrEvent, event }),
      onClosed: () => args.sink.close(),
    })
    const heartbeat = setInterval(() => {
      args.sink.push({ type: EGithubPrStreamFrame.Heartbeat })
    }, PR_STREAM_HEARTBEAT_INTERVAL_MS)

    return () => {
      clearInterval(heartbeat)
      close()
    }
  }

  private async replayKnownStates(args: { sink: PrFrameSink; userId: string }): Promise<void> {
    try {
      const states = await this.subscriptions.currentStates({ userId: args.userId })
      for (const state of states) args.sink.push({ type: EGithubPrStreamFrame.PrState, state })
    } catch (failure) {
      this.logger.warn(`replaying known states for ${args.userId} failed: ${String(failure)}`)
    }
  }

  private async replayMailbox(args: {
    sink: PrFrameSink
    userId: string
    threadId: string | undefined
  }): Promise<void> {
    try {
      const events =
        args.threadId === undefined
          ? await this.mailbox.replayUndelivered({ userId: args.userId })
          : await this.mailbox.replayForThread({ userId: args.userId, threadId: args.threadId })
      for (const event of events) args.sink.push({ type: EGithubPrStreamFrame.PrEvent, event })
    } catch (failure) {
      this.logger.warn(`replaying the mailbox for ${args.userId} failed: ${String(failure)}`)
    }
  }
}

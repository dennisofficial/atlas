import {
  EGithubPrStreamFrame,
  EGithubWakeFrame,
  githubPrAckEventsInputSchema,
  githubPrAckEventsOutputSchema,
  type GithubPrAckEventsInput,
  githubPrStatesOutputSchema,
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
import { SandboxesService } from '../../platform/sandboxes/sandboxes.service'
import {
  SessionOrSandboxMiddleware,
  type SessionOrSandboxTrpcCtx,
} from '../../platform/sessions/session-or-sandbox.middleware'
import { GithubPrEventMailboxService } from '@dltech/atlas-github'
import { type PrFrameSink, prStreamFrames } from '@dltech/atlas-github'
import { GithubPrFanoutService } from '@dltech/atlas-github'
import { GithubSubscriptionsService } from '@dltech/atlas-github'
import { GithubRequestCoordinator } from '@dltech/atlas-github'
import { GithubService } from '@dltech/atlas-github'
import { LinkedPrAccess } from '@dltech/atlas-github'
import { attachPrStates } from './github-pr-states.stream'
import { ThreadSignalsService } from '../../platform/sessions/thread-signals.service'

export const PR_STREAM_HEARTBEAT_INTERVAL_MS = 30_000

@Router({ alias: 'githubPrs' })
@UseMiddlewares(SessionOrSandboxMiddleware)
export class GithubPrStreamRouter {
  private readonly logger = new Logger(GithubPrStreamRouter.name)
  private readonly linkedAccess: LinkedPrAccess

  constructor(
    private readonly fanout: GithubPrFanoutService,
    private readonly subscriptions: GithubSubscriptionsService,
    private readonly drain: DrainStateService,
    private readonly mailbox: GithubPrEventMailboxService,
    coordinator: GithubRequestCoordinator,
    private readonly sandboxes: SandboxesService,
    github: GithubService,
    private readonly signals: ThreadSignalsService,
  ) {
    this.linkedAccess = new LinkedPrAccess({ coordinator, github })
  }

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
    const threadId = await this.ackThread({ ctx, requested: input.threadId })
    const acked = await this.mailbox.acknowledge({ threadId, eventIds: input.eventIds })
    if (acked === 0) {
      this.logger.warn(
        `acked no pr-event delivery row for thread ${threadId} (${input.eventIds.length} event(s) requested)`,
      )
    }
    return { acked }
  }

  /** A pod or sandbox acks for its own thread or a sub-agent thread of it, never another thread. */
  private async ackThread(args: {
    ctx: SessionOrSandboxTrpcCtx
    requested: string
  }): Promise<string> {
    const familyThreadId = args.ctx.pod?.threadId ?? args.ctx.sandbox?.threadId
    if (familyThreadId === undefined || familyThreadId === args.requested) return args.requested
    try {
      await this.sandboxes.assertThreadInFamily({
        sandboxThreadId: familyThreadId,
        threadId: args.requested,
      })
      return args.requested
    } catch {
      return familyThreadId
    }
  }

  @Subscription({ output: githubPrStatesOutputSchema })
  states(
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
    @Options() opts: ProcedureOptions,
  ): AsyncGenerator<GithubPrStatesFrame> {
    if (this.drain.isDraining()) {
      throw new ServiceUnavailableException('the api is restarting — retry the stream')
    }
    const userId = ctx.auth.userId
    return prStreamFrames<GithubPrStatesFrame>({
      signal: opts.signal,
      attach: (sink) =>
        attachPrStates({
          userId,
          signal: opts.signal,
          sink,
          access: this.linkedAccess,
          subscriptions: this.subscriptions,
          fanout: this.fanout,
          signals: this.signals,
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

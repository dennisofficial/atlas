import {
  EGithubPrStreamFrame,
  githubPrStreamOutputSchema,
  type GithubPrStreamFrame,
} from '@dltech/atlas-wire'
import { Logger, ServiceUnavailableException } from '@nestjs/common'
import {
  Ctx,
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
    return prStreamFrames({ signal: opts.signal, attach: (sink) => this.attach({ sink, userId }) })
  }

  private attach(args: { sink: PrFrameSink; userId: string }): () => void {
    args.sink.push({ type: EGithubPrStreamFrame.Heartbeat })
    void this.replayKnownStates(args)
    void this.replayMailbox(args)
    const close = this.fanout.openStream({
      userId: args.userId,
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

  private async replayMailbox(args: { sink: PrFrameSink; userId: string }): Promise<void> {
    try {
      const events = await this.mailbox.replayUndelivered({ userId: args.userId })
      for (const event of events) args.sink.push({ type: EGithubPrStreamFrame.PrEvent, event })
    } catch (failure) {
      this.logger.warn(`replaying the mailbox for ${args.userId} failed: ${String(failure)}`)
    }
  }
}

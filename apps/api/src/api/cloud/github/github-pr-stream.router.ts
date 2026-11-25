import { githubPrStatesOutputSchema, type GithubPrStatesFrame } from '@dltech/atlas-wire'
import { Logger, ServiceUnavailableException } from '@nestjs/common'
import {
  Ctx,
  Options,
  type ProcedureOptions,
  Router,
  Subscription,
  UseMiddlewares,
} from 'nestjs-trpc'
import { DrainStateService } from '../../platform/health/drain-state.service'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { prStreamFrames } from '@dltech/atlas-github'
import { GithubPrFanoutService } from '@dltech/atlas-github'
import { GithubSubscriptionsService } from '@dltech/atlas-github'
import { attachPrStates } from './github-pr-states.stream'

export const PR_STREAM_HEARTBEAT_INTERVAL_MS = 30_000

@Router({ alias: 'githubPrs' })
@UseMiddlewares(SessionMiddleware)
export class GithubPrStreamRouter {
  private readonly logger = new Logger(GithubPrStreamRouter.name)

  constructor(
    private readonly fanout: GithubPrFanoutService,
    private readonly subscriptions: GithubSubscriptionsService,
    private readonly drain: DrainStateService,
  ) {}

  @Subscription({ output: githubPrStatesOutputSchema })
  states(
    @Ctx() ctx: SessionTrpcCtx,
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
          subscriptions: this.subscriptions,
          fanout: this.fanout,
          logger: this.logger,
        }),
    })
  }
}

import {
  Controller,
  Logger,
  MessageEvent,
  Req,
  ServiceUnavailableException,
  Sse,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import { Observable, type Subscriber } from 'rxjs'
import type { AuthenticatedRequest } from '../../../_core/types/auth.types'
import { SessionAuthGuard } from '../../../_module/session/session-auth.guard'
import { DrainStateService } from '../../platform/health/drain-state.service'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import { EPrRealtimeEvent } from './github-realtime.types'
import { GithubSubscriptionsService } from './github-subscriptions.service'

const HEARTBEAT_INTERVAL_MS = 30_000

@Controller({ path: 'github/prs', version: '1' })
@UseGuards(SessionAuthGuard)
export class GithubPrStreamController {
  private readonly logger = new Logger(GithubPrStreamController.name)

  constructor(
    private readonly fanout: GithubPrFanoutService,
    private readonly subscriptions: GithubSubscriptionsService,
    private readonly drain: DrainStateService,
  ) {}

  @Sse('stream')
  handleStream(@Req() request: AuthenticatedRequest): Observable<MessageEvent> {
    const auth = request.auth
    if (!auth) throw new UnauthorizedException('a valid session is required')
    if (this.drain.isDraining()) {
      throw new ServiceUnavailableException('the api is restarting — retry the stream')
    }
    const userId = auth.userId

    return new Observable<MessageEvent>((subscriber) => this.attach({ subscriber, userId }))
  }

  private attach(args: { subscriber: Subscriber<MessageEvent>; userId: string }): () => void {
    void this.replayKnownStates(args)
    const close = this.fanout.openStream({
      userId: args.userId,
      handler: (state) => {
        args.subscriber.next({ type: EPrRealtimeEvent.PrState, data: state })
      },
      onClosed: () => args.subscriber.complete(),
    })
    const heartbeat = setInterval(() => {
      args.subscriber.next({ type: EPrRealtimeEvent.Heartbeat, data: {} })
    }, HEARTBEAT_INTERVAL_MS)

    return () => {
      clearInterval(heartbeat)
      close()
    }
  }

  private async replayKnownStates(args: {
    subscriber: Subscriber<MessageEvent>
    userId: string
  }): Promise<void> {
    try {
      const states = await this.subscriptions.currentStates({ userId: args.userId })
      for (const state of states) {
        args.subscriber.next({ type: EPrRealtimeEvent.PrState, data: state })
      }
    } catch (failure) {
      this.logger.warn(`replaying known states for ${args.userId} failed: ${String(failure)}`)
    }
  }
}

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
import { SandboxReachable } from '../../../_core/decorators/sandbox-reachable.decorator'
import type { AuthenticatedRequest } from '../../../_core/types/auth.types'
import { DrainStateService } from '../../platform/health/drain-state.service'
import { SessionOrSandboxGuard } from '../../platform/sessions/session-or-sandbox.guard'
import { GithubPrEventMailboxService } from './github-pr-event-mailbox.service'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import { EPrRealtimeEvent } from './github-realtime.types'
import { GithubSubscriptionsService } from './github-subscriptions.service'

const HEARTBEAT_INTERVAL_MS = 30_000

@Controller({ path: 'github/prs', version: '1' })
@UseGuards(SessionOrSandboxGuard)
@SandboxReachable()
export class GithubPrStreamController {
  private readonly logger = new Logger(GithubPrStreamController.name)

  constructor(
    private readonly fanout: GithubPrFanoutService,
    private readonly subscriptions: GithubSubscriptionsService,
    private readonly drain: DrainStateService,
    private readonly mailbox: GithubPrEventMailboxService,
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
    void this.replayMailbox(args)
    const close = this.fanout.openStream({
      userId: args.userId,
      handler: (state) => {
        args.subscriber.next({ type: EPrRealtimeEvent.PrState, data: state })
      },
      eventHandler: (event) => {
        args.subscriber.next({ type: EPrRealtimeEvent.PrEvent, data: event })
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

  private async replayMailbox(args: {
    subscriber: Subscriber<MessageEvent>
    userId: string
  }): Promise<void> {
    try {
      const events = await this.mailbox.replayUndelivered({ userId: args.userId })
      for (const event of events) {
        args.subscriber.next({ type: EPrRealtimeEvent.PrEvent, data: event })
      }
    } catch (failure) {
      this.logger.warn(`replaying the mailbox for ${args.userId} failed: ${String(failure)}`)
    }
  }
}

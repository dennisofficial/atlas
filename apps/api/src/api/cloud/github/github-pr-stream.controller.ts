import { Controller, MessageEvent, Req, Sse, UnauthorizedException, UseGuards } from '@nestjs/common'
import { Observable, type Subscriber } from 'rxjs'
import type { AuthenticatedRequest } from '../../../_core/types/auth.types'
import { SessionAuthGuard } from '../../../_module/session/session-auth.guard'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import { EPrRealtimeEvent } from './github-realtime.types'

const HEARTBEAT_INTERVAL_MS = 30_000

@Controller({ path: 'github/prs', version: '1' })
@UseGuards(SessionAuthGuard)
export class GithubPrStreamController {
  constructor(private readonly fanout: GithubPrFanoutService) {}

  @Sse('stream')
  handleStream(@Req() request: AuthenticatedRequest): Observable<MessageEvent> {
    const auth = request.auth
    if (!auth) throw new UnauthorizedException('a valid session is required')
    const userId = auth.userId

    return new Observable<MessageEvent>((subscriber) => this.attach({ subscriber, userId }))
  }

  private attach(args: { subscriber: Subscriber<MessageEvent>; userId: string }): () => void {
    const close = this.fanout.openStream({
      userId: args.userId,
      handler: (state) => {
        args.subscriber.next({ type: EPrRealtimeEvent.PrState, data: state })
      },
    })
    const heartbeat = setInterval(() => {
      args.subscriber.next({ type: EPrRealtimeEvent.Heartbeat, data: {} })
    }, HEARTBEAT_INTERVAL_MS)

    return () => {
      clearInterval(heartbeat)
      close()
    }
  }
}

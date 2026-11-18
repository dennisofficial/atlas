import { Controller, Get, Inject, Res, VERSION_NEUTRAL } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'

import { SESSION_STREAM } from '../host/tokens'
import type { HostReply } from './host-request'
import type { SessionStream } from '../stream/session-stream'

@Controller({ version: VERSION_NEUTRAL })
@SkipThrottle()
export class HealthController {
  constructor(@Inject(SESSION_STREAM) private readonly stream: SessionStream) {}

  @Get('healthz')
  handleHealth(@Res() response: HostReply): void {
    const draining = this.stream.isDraining()
    response.status(draining ? 503 : 200)
    response.json({ ok: !draining, connections: this.stream.connections() })
  }
}

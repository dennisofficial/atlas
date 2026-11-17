import { Controller, Get, Inject, Res, VERSION_NEUTRAL } from '@nestjs/common'

import { STREAM } from '../host/tokens'
import type { HostReply } from './host-request'
import { StreamService } from '../stream/stream-service'

@Controller({ version: VERSION_NEUTRAL })
export class HealthController {
  constructor(@Inject(STREAM) private readonly stream: StreamService) {}

  @Get('healthz')
  handleHealth(@Res() response: HostReply): void {
    const draining = this.stream.isDraining()
    response.status(draining ? 503 : 200)
    response.json({ ok: !draining, connections: this.stream.connections() })
  }
}

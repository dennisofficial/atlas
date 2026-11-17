import { Controller, Get, Res, VERSION_NEUTRAL } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'

import type { HostReply } from './host-request'

@Controller({ version: VERSION_NEUTRAL })
@SkipThrottle()
export class StreamUpgradeController {
  @Get('stream')
  handlePlainRequest(@Res() response: HostReply): void {
    response.status(426).send('upgrade required')
  }
}

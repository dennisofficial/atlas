import { Controller, Get, Res, VERSION_NEUTRAL } from '@nestjs/common'

import type { HostReply } from './host-request'

@Controller({ version: VERSION_NEUTRAL })
export class StreamUpgradeController {
  @Get('stream')
  handlePlainRequest(@Res() response: HostReply): void {
    response.status(426).send('upgrade required')
  }
}

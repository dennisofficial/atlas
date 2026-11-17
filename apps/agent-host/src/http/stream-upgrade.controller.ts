import { Controller, Get, Res } from '@nestjs/common'

import type { HostReply } from './host-request'

@Controller()
export class StreamUpgradeController {
  @Get('stream')
  handlePlainRequest(@Res() response: HostReply): void {
    response.status(426).send('upgrade required')
  }
}

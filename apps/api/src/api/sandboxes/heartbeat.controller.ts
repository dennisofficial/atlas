import { Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common'
import { SandboxTokenGuard } from './sandbox-token.guard'
import { SandboxesService } from './sandboxes.service'

@Controller({ path: 'sandboxes', version: '1' })
@UseGuards(SandboxTokenGuard)
export class SandboxHeartbeatController {
  constructor(private readonly sandboxes: SandboxesService) {}

  @Post(':threadId/heartbeat')
  @HttpCode(204)
  async handleHeartbeat(@Param('threadId') threadId: string): Promise<void> {
    await this.sandboxes.heartbeat({ threadId })
  }
}

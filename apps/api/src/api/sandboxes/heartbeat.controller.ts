import { Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import { SandboxTokenGuard } from './sandbox-token.guard'
import { SandboxesService } from './sandboxes.service'

/** Serve heartbeats every 20s while a turn runs; the global per-IP throttler would kill it mid-turn. */
@Controller({ path: 'sandboxes', version: '1' })
@UseGuards(SandboxTokenGuard)
@SkipThrottle()
export class SandboxHeartbeatController {
  constructor(private readonly sandboxes: SandboxesService) {}

  @Post(':threadId/heartbeat')
  @HttpCode(204)
  async handleHeartbeat(@Param('threadId') threadId: string): Promise<void> {
    await this.sandboxes.heartbeat({ threadId })
  }
}

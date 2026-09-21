import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import { SandboxTokenGuard } from './sandbox-token.guard'
import { SandboxesService } from './sandboxes.service'
import type { SandboxWorkspaceDto } from './sandboxes.types'

/** Serve fetches its workspace spec on every launch and re-attach; never throttle it. */
@Controller({ path: 'sandboxes', version: '1' })
@UseGuards(SandboxTokenGuard)
@SkipThrottle()
export class SandboxWorkspaceController {
  constructor(private readonly sandboxes: SandboxesService) {}

  @Get(':threadId/workspace')
  handleWorkspace(@Param('threadId') threadId: string): Promise<SandboxWorkspaceDto> {
    return this.sandboxes.workspace({ threadId })
  }
}

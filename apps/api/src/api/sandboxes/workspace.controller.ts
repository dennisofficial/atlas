import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import { SandboxTokenGuard } from './sandbox-token.guard'
import { SandboxesService } from './sandboxes.service'
import type { SandboxWorkspaceDto } from './sandboxes.types'

@Controller({ path: 'sandboxes', version: '1' })
@UseGuards(SandboxTokenGuard)
export class SandboxWorkspaceController {
  constructor(private readonly sandboxes: SandboxesService) {}

  @Get(':threadId/workspace')
  handleWorkspace(@Param('threadId') threadId: string): Promise<SandboxWorkspaceDto> {
    return this.sandboxes.workspace({ threadId })
  }
}

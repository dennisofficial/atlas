import { Controller, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common'
import type { SandboxProvisionReply } from '@dltech/atlas-wire'
import type { AuthenticatedRequest } from '../../../_core/types/auth.types'
import { SessionAuthGuard } from '../../../_module/session/session-auth.guard'
import { userIdOf } from '../../platform/sessions/session-user'
import { SandboxProvisioningService } from './sandbox-provisioning.service'

@Controller({ path: 'threads', version: '1' })
@UseGuards(SessionAuthGuard)
export class SandboxProvisioningController {
  constructor(private readonly provisioning: SandboxProvisioningService) {}

  @Post(':threadId/sandbox')
  @HttpCode(200)
  handleProvision(
    @Req() request: AuthenticatedRequest,
    @Param('threadId') threadId: string,
  ): Promise<SandboxProvisionReply> {
    return this.provisioning.provision({ userId: userIdOf(request), threadId })
  }
}

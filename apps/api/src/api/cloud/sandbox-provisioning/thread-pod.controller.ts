import { Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common'
import type { PodConnectReply, PodStatus } from '@dltech/atlas-wire'
import type { AuthenticatedRequest } from '../../../_core/types/auth.types'
import { SessionAuthGuard } from '../../../_module/session/session-auth.guard'
import { userIdOf } from '../../platform/sessions/session-user'
import { ThreadPodService } from './thread-pod.service'

@Controller({ path: 'threads', version: '1' })
@UseGuards(SessionAuthGuard)
export class ThreadPodController {
  constructor(private readonly pods: ThreadPodService) {}

  @Get(':threadId/pod')
  handleStatus(
    @Req() request: AuthenticatedRequest,
    @Param('threadId') threadId: string,
  ): Promise<PodStatus> {
    return this.pods.status({ userId: userIdOf(request), threadId })
  }

  @Post(':threadId/pod/connect')
  @HttpCode(200)
  handleConnect(
    @Req() request: AuthenticatedRequest,
    @Param('threadId') threadId: string,
  ): Promise<PodConnectReply> {
    return this.pods.connect({ userId: userIdOf(request), threadId })
  }
}

import { Body, Controller, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common'
import type { ThreadMessageReply } from '@dltech/atlas-wire'
import type { AuthenticatedRequest } from '../../../_core/types/auth.types'
import { SessionAuthGuard } from '../../../_module/session/session-auth.guard'
import { userIdOf } from '../../platform/sessions/session-user'
import { ThreadMessageDto } from './thread-messages.dto'
import { ThreadMessagesService } from './thread-messages.service'

@Controller({ path: 'threads', version: '1' })
@UseGuards(SessionAuthGuard)
export class ThreadMessagesController {
  constructor(private readonly messages: ThreadMessagesService) {}

  @Post(':threadId/messages')
  @HttpCode(200)
  handleSend(
    @Req() request: AuthenticatedRequest,
    @Param('threadId') threadId: string,
    @Body() body: ThreadMessageDto,
  ): Promise<ThreadMessageReply> {
    return this.messages.send({
      userId: userIdOf(request),
      threadId,
      sendId: body.sendId,
      text: body.text,
    })
  }
}

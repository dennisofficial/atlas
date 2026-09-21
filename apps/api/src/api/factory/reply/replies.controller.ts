import { Body, Controller, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import { GuardedReplyService, type GuardedReplyResult } from './guarded-reply.service'
import { OrchestratorSandboxGuard, type OrchestratorSandboxRequest } from './orchestrator-sandbox.guard'
import { CreateReplyDto } from './replies.dto'

@Controller({ path: 'factory/replies', version: '1' })
@SkipThrottle()
@UseGuards(OrchestratorSandboxGuard)
export class FactoryRepliesController {
  constructor(private readonly replies: GuardedReplyService) {}

  @Post()
  handleReply(
    @Req() request: OrchestratorSandboxRequest,
    @Body() body: CreateReplyDto,
  ): Promise<GuardedReplyResult> {
    const sandbox = request.orchestratorSandbox
    if (sandbox === undefined) throw new UnauthorizedException('a sandbox session token is required')
    return this.replies.reply({
      orchestratorThreadId: sandbox.threadId,
      surface: body.surface,
      externalId: body.externalId,
      body: body.body,
    })
  }
}

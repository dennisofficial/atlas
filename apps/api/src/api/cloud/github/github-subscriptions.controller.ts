import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import { SandboxReachable } from '../../../_core/decorators/sandbox-reachable.decorator'
import type { AuthenticatedRequest } from '../../../_core/types/auth.types'
import { SessionOrSandboxGuard } from '../../platform/sessions/session-or-sandbox.guard'
import { SubscribeDto } from './github-realtime.dto'
import type { GithubSubscriptionDto } from './github-realtime.types'
import { GithubSubscriptionsService } from './github-subscriptions.service'

function userIdOf(request: AuthenticatedRequest): string {
  const auth = request.auth
  if (!auth) throw new UnauthorizedException('a valid session is required')
  return auth.userId
}

/**
 * Session-or-sandbox because the serve process inside a container subscribes for its own thread:
 * it holds only the thread-scoped sandbox token, which the guard resolves to the owning user, so
 * hook creation and REST fills still ride that user's stored GitHub token.
 */
@Controller({ path: 'github/subscriptions', version: '1' })
@UseGuards(SessionOrSandboxGuard)
@SandboxReachable()
export class GithubSubscriptionsController {
  constructor(private readonly subscriptions: GithubSubscriptionsService) {}

  @Post()
  handleSubscribe(
    @Req() request: AuthenticatedRequest,
    @Body() body: SubscribeDto,
  ): Promise<GithubSubscriptionDto> {
    return this.subscriptions.subscribe({
      userId: userIdOf(request),
      repoFullName: body.repoFullName,
      ...(body.prNumber === undefined ? {} : { prNumber: body.prNumber }),
      ...(body.branch === undefined ? {} : { branch: body.branch }),
      ...(request.sandbox === undefined
        ? {}
        : { threadId: request.sandbox.threadId, sandboxId: request.sandbox.sandboxId }),
    })
  }

  @Delete(':id')
  @HttpCode(204)
  async handleUnsubscribe(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<void> {
    await this.subscriptions.unsubscribe({ userId: userIdOf(request), subscriptionId: id })
  }

  @Post(':id/heartbeat')
  handleHeartbeat(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<{ expiresAt: string }> {
    return this.subscriptions.heartbeat({
      userId: userIdOf(request),
      subscriptionId: id,
      ...(request.sandbox === undefined
        ? {}
        : { threadId: request.sandbox.threadId, sandboxId: request.sandbox.sandboxId }),
    })
  }
}

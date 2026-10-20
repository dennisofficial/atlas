import {
  Body,
  Controller,
  Get,
  Header,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import type {
  PublishedBundleCurrent,
  PublishedBundleSummary,
  PublishedBundleUpload,
} from '@dltech/atlas-wire'
import { PodReachable } from '../../../_core/decorators/pod-reachable.decorator'
import { SandboxReachable } from '../../../_core/decorators/sandbox-reachable.decorator'
import type { AuthenticatedRequest } from '../../../_core/types/auth.types'
import { SessionAuthGuard } from '../../../_module/session/session-auth.guard'
import { SessionOrSandboxGuard } from '../../platform/sessions/session-or-sandbox.guard'
import { CommitBundleDto } from './published-bundles.dto'
import { PublishedBundlesService } from './published-bundles.service'

const NO_STORE = 'no-store'

function userIdOf(request: AuthenticatedRequest): string {
  const auth = request.auth
  if (!auth) throw new UnauthorizedException('a valid session is required')
  return auth.userId
}

@Controller({ path: 'published-bundles', version: '1' })
export class PublishedBundlesController {
  constructor(private readonly bundles: PublishedBundlesService) {}

  @Post('uploads')
  @UseGuards(SessionAuthGuard)
  @Header('Cache-Control', NO_STORE)
  handleIssueUpload(@Req() request: AuthenticatedRequest): Promise<PublishedBundleUpload> {
    return this.bundles.issueUpload({ userId: userIdOf(request) })
  }

  @Post()
  @UseGuards(SessionAuthGuard)
  @Header('Cache-Control', NO_STORE)
  handleCommit(
    @Req() request: AuthenticatedRequest,
    @Body() body: CommitBundleDto,
  ): Promise<PublishedBundleSummary> {
    return this.bundles.commit({ userId: userIdOf(request), body })
  }

  @Get('current')
  @UseGuards(SessionOrSandboxGuard)
  @PodReachable()
  @SandboxReachable()
  @Header('Cache-Control', NO_STORE)
  handleCurrent(@Req() request: AuthenticatedRequest): Promise<PublishedBundleCurrent> {
    return this.bundles.current({ userId: userIdOf(request) })
  }
}

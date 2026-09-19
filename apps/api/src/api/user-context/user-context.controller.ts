import {
  Body,
  Controller,
  Get,
  HttpCode,
  Put,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import type { AuthenticatedRequest } from '../../_core/types/auth.types'
import { SessionOrSandboxGuard } from '../sessions/session-or-sandbox.guard'
import { PutMemoryBundleDto } from './user-context.dto'
import { UserContextService } from './user-context.service'
import type { MemoryBundleDto } from './user-context.types'

function userIdOf(request: AuthenticatedRequest): string {
  const auth = request.auth
  if (!auth) throw new UnauthorizedException('a valid session is required')
  return auth.userId
}

@Controller({ path: 'user-context', version: '1' })
@UseGuards(SessionOrSandboxGuard)
export class UserContextController {
  constructor(private readonly userContext: UserContextService) {}

  @Get('memory')
  async handleGet(@Req() request: AuthenticatedRequest): Promise<MemoryBundleDto> {
    return { bundle: await this.userContext.getMemory({ userId: userIdOf(request) }) }
  }

  @Put('memory')
  @HttpCode(204)
  async handlePut(
    @Req() request: AuthenticatedRequest,
    @Body() body: PutMemoryBundleDto,
  ): Promise<void> {
    await this.userContext.putMemory({ userId: userIdOf(request), bundle: body.bundle })
  }
}

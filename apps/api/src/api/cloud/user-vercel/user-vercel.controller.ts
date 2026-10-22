import type { UserVercelCredential } from '@dltech/atlas-wire/web'
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Put,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import type { AuthenticatedRequest } from '../../../_core/types/auth.types'
import { SessionAuthGuard } from '../../../_module/session/session-auth.guard'
import { UserVercelService } from './user-vercel.service'

function userIdOf(request: AuthenticatedRequest): string {
  const auth = request.auth
  if (!auth) throw new UnauthorizedException('a valid session is required')
  return auth.userId
}

@Controller({ path: 'me/vercel', version: '1' })
@UseGuards(SessionAuthGuard)
export class UserVercelController {
  constructor(private readonly vercel: UserVercelService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  handleRead(@Req() request: AuthenticatedRequest): Promise<UserVercelCredential> {
    return this.vercel.read({ userId: userIdOf(request) })
  }

  @Put()
  @HttpCode(204)
  async handleWrite(@Req() request: AuthenticatedRequest, @Body() body: unknown): Promise<void> {
    await this.vercel.write({ userId: userIdOf(request), body })
  }

  @Delete()
  @HttpCode(204)
  async handleRemove(@Req() request: AuthenticatedRequest): Promise<void> {
    await this.vercel.remove({ userId: userIdOf(request) })
  }
}

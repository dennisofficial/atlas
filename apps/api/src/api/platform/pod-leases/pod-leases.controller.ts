import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Put,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import type { AuthenticatedRequest } from '../../../_core/types/auth.types'
import { SessionAuthGuard } from '../../../_module/session/session-auth.guard'
import { RegisterPodLeaseDto } from './pod-leases.dto'
import { PodLeasesService } from './pod-leases.service'

function userIdOf(request: AuthenticatedRequest): string {
  const auth = request.auth
  if (!auth) throw new UnauthorizedException('a valid session is required')
  return auth.userId
}

@Controller({ path: 'pod-leases', version: '1' })
@UseGuards(SessionAuthGuard)
export class PodLeasesController {
  constructor(private readonly leases: PodLeasesService) {}

  @Put(':threadId')
  @HttpCode(204)
  async handleRegister(
    @Req() request: AuthenticatedRequest,
    @Param('threadId') threadId: string,
    @Body() body: RegisterPodLeaseDto,
  ): Promise<void> {
    await this.leases.register({ userId: userIdOf(request), threadId, token: body.token })
  }

  @Delete(':threadId')
  @HttpCode(204)
  async handleRelease(
    @Req() request: AuthenticatedRequest,
    @Param('threadId') threadId: string,
  ): Promise<void> {
    await this.leases.release({ userId: userIdOf(request), threadId })
  }
}

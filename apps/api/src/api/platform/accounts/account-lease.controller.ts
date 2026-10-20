import { Controller, Get, Header, Req, UnauthorizedException, UseGuards } from '@nestjs/common'
import { PodReachable } from '../../../_core/decorators/pod-reachable.decorator'
import { SandboxReachable } from '../../../_core/decorators/sandbox-reachable.decorator'
import type { AuthenticatedRequest } from '../../../_core/types/auth.types'
import { SessionOrSandboxGuard } from '../sessions/session-or-sandbox.guard'
import { AccountsService } from './accounts.service'
import type { AccountLeaseDto } from './accounts.types'

const NO_STORE = 'no-store'

function userIdOf(request: AuthenticatedRequest): string {
  const auth = request.auth
  if (!auth) throw new UnauthorizedException('a valid session is required')
  return auth.userId
}

@Controller({ path: 'account-lease', version: '1' })
export class AccountLeaseController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  @UseGuards(SessionOrSandboxGuard)
  @PodReachable()
  @SandboxReachable()
  @Header('Cache-Control', NO_STORE)
  handleLease(@Req() request: AuthenticatedRequest): Promise<AccountLeaseDto> {
    return this.accounts.lease({ userId: userIdOf(request) })
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import type { AuthenticatedRequest } from '../../../_core/types/auth.types'
import { SessionOrSandboxGuard } from '../sessions/session-or-sandbox.guard'
import {
  AccessTokenRequestDto,
  CreateAccountDto,
  ReplaceSecretDto,
  SetActiveDto,
  SetStatusDto,
} from './accounts.dto'
import { AccountsService } from './accounts.service'
import { BrokerService } from './broker.service'
import type {
  AccessTokenDto,
  AccountDto,
  ActiveAccountDto,
  StoredAccountDto,
} from './accounts.types'

function userIdOf(request: AuthenticatedRequest): string {
  const auth = request.auth
  if (!auth) throw new UnauthorizedException('a valid session is required')
  return auth.userId
}

@Controller({ path: 'accounts', version: '1' })
@UseGuards(SessionOrSandboxGuard)
export class AccountsController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly broker: BrokerService,
  ) {}

  @Get()
  handleList(@Req() request: AuthenticatedRequest): Promise<AccountDto[]> {
    return this.accounts.list({ userId: userIdOf(request) })
  }

  @Post()
  handleCreate(
    @Req() request: AuthenticatedRequest,
    @Body() body: CreateAccountDto,
  ): Promise<AccountDto> {
    return this.accounts.add({ userId: userIdOf(request), draft: body })
  }

  @Put('active')
  @HttpCode(204)
  async handleSetActive(
    @Req() request: AuthenticatedRequest,
    @Body() body: SetActiveDto,
  ): Promise<void> {
    await this.accounts.setActive({ userId: userIdOf(request), draft: body })
  }

  @Get('active/:provider')
  handleActiveFor(
    @Req() request: AuthenticatedRequest,
    @Param('provider') provider: string,
  ): Promise<ActiveAccountDto> {
    return this.accounts.activeFor({ userId: userIdOf(request), provider })
  }

  @Get(':id')
  handleRead(
    @Req() request: AuthenticatedRequest,
    @Param('id') accountId: string,
  ): Promise<StoredAccountDto> {
    return this.accounts.read({ userId: userIdOf(request), accountId })
  }

  @Post(':id/access-token')
  handleAccessToken(
    @Req() request: AuthenticatedRequest,
    @Param('id') accountId: string,
    @Body() body: AccessTokenRequestDto,
  ): Promise<AccessTokenDto> {
    return this.broker.accessToken({
      userId: userIdOf(request),
      accountId,
      ...(body.rejectedAccessToken === undefined
        ? {}
        : { rejectedAccessToken: body.rejectedAccessToken }),
    })
  }

  @Put(':id/secret')
  @HttpCode(204)
  async handleReplaceSecret(
    @Req() request: AuthenticatedRequest,
    @Param('id') accountId: string,
    @Body() body: ReplaceSecretDto,
  ): Promise<void> {
    await this.accounts.replaceSecret({
      userId: userIdOf(request),
      accountId,
      secret: body.secret,
    })
  }

  @Patch(':id/status')
  @HttpCode(204)
  async handleSetStatus(
    @Req() request: AuthenticatedRequest,
    @Param('id') accountId: string,
    @Body() body: SetStatusDto,
  ): Promise<void> {
    await this.accounts.setStatus({ userId: userIdOf(request), accountId, status: body })
  }

  @Delete(':id')
  @HttpCode(204)
  async handleRemove(
    @Req() request: AuthenticatedRequest,
    @Param('id') accountId: string,
  ): Promise<void> {
    await this.accounts.remove({ userId: userIdOf(request), accountId })
  }
}

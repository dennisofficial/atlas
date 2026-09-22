import { Body, Controller, Get, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common'
import type { SandboxAuthenticatedRequest } from '../sandboxes/sandbox-token.guard'
import { SandboxTokenGuard } from '../sandboxes/sandbox-token.guard'
import type { SecretDto } from '../../cloud/secrets/secrets.types'
import type { SandboxAccessTokenDto, SandboxAccountsDto } from './accounts.types'
import { SandboxAccessTokenRequestDto, SandboxSecretsRequestDto } from './sandbox-broker.dto'
import { SandboxBrokerService } from './sandbox-broker.service'

function sandboxUserIdOf(request: SandboxAuthenticatedRequest): string {
  const sandbox = request.sandbox
  if (sandbox === undefined) throw new UnauthorizedException('a sandbox session token is required')
  return sandbox.userId
}

@Controller({ path: 'sandboxes/:threadId/broker', version: '1' })
@UseGuards(SandboxTokenGuard)
export class SandboxBrokerController {
  constructor(private readonly broker: SandboxBrokerService) {}

  @Get('accounts')
  handleAccounts(@Req() request: SandboxAuthenticatedRequest): Promise<SandboxAccountsDto> {
    return this.broker.listAccounts({ userId: sandboxUserIdOf(request) })
  }

  @Post('access-token')
  handleAccessToken(
    @Req() request: SandboxAuthenticatedRequest,
    @Body() body: SandboxAccessTokenRequestDto,
  ): Promise<SandboxAccessTokenDto> {
    return this.broker.accessToken({ userId: sandboxUserIdOf(request), ...body })
  }

  @Post('secrets')
  async handleSecrets(
    @Req() request: SandboxAuthenticatedRequest,
    @Body() body: SandboxSecretsRequestDto,
  ): Promise<{ secrets: SecretDto[] }> {
    return { secrets: await this.broker.namedSecrets({ userId: sandboxUserIdOf(request), names: body.names }) }
  }
}

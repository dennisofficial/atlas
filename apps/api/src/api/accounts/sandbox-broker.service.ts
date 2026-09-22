import { Injectable, NotFoundException } from '@nestjs/common'
import { db } from '../../db'
import { SecretCipherService } from '../../_lib/crypto/secret-cipher.service'
import { SecretsService } from '../secrets/secrets.service'
import type { SecretDto } from '../secrets/secrets.types'
import { AccountsService } from './accounts.service'
import type { AccountSecret, SandboxAccessTokenDto, SandboxAccountsDto } from './accounts.types'
import { EAuthKind } from './accounts.types'
import { BrokerService } from './broker.service'

/**
 * The serve process inside a sandbox holds only its sandbox session token — a credential any
 * process in that sandbox can read — so it never touches the user-facing accounts and secrets
 * routes. This broker is what it gets instead: every answer is resolved per thread's owner and
 * carries the least a running agent needs. Access tokens are minted; the sealed account secret
 * (refresh token included) and the secret store at large stay behind the control plane.
 */
@Injectable()
export class SandboxBrokerService {
  constructor(
    private readonly accounts: AccountsService,
    private readonly broker: BrokerService,
    private readonly secrets: SecretsService,
    private readonly cipher: SecretCipherService,
  ) {}

  async listAccounts(args: { userId: string }): Promise<SandboxAccountsDto> {
    const [accounts, pointers] = await Promise.all([
      this.accounts.list({ userId: args.userId }),
      db.activeAccount.findMany({
        where: { userId: args.userId },
        select: { provider: true, accountId: true },
      }),
    ])
    return { accounts, active: pointers }
  }

  async accessToken(args: {
    userId: string
    provider: string
    accountId?: string | undefined
    rejectedAccessToken?: string | undefined
  }): Promise<SandboxAccessTokenDto> {
    const accountId = args.accountId ?? (await this.activeAccountId(args))
    const minted = await this.broker.accessToken({
      userId: args.userId,
      accountId,
      ...(args.rejectedAccessToken === undefined
        ? {}
        : { rejectedAccessToken: args.rejectedAccessToken }),
    })

    const row = await db.agentAccount.findFirst({ where: { id: accountId, userId: args.userId } })
    if (row === null) throw new NotFoundException('account not found')
    const secret = JSON.parse(this.cipher.decrypt(row.sealedSecret)) as AccountSecret

    return {
      accountId,
      kind: secret.kind,
      accessToken: minted.accessToken,
      expiresAt: minted.expiresAt,
      ...(secret.kind === EAuthKind.Oauth && secret.tokens.accountId !== undefined
        ? { providerAccountId: secret.tokens.accountId }
        : {}),
    }
  }

  namedSecrets(args: { userId: string; names: string[] }): Promise<SecretDto[]> {
    return this.secrets.listNamed(args)
  }

  private async activeAccountId(args: { userId: string; provider: string }): Promise<string> {
    const pointer = await db.activeAccount.findUnique({
      where: { userId_provider: { userId: args.userId, provider: args.provider } },
    })
    if (pointer === null) {
      throw new NotFoundException(`no active ${args.provider} account — sign in on the operator's machine first`)
    }
    return pointer.accountId
  }
}

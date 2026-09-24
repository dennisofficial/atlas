import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { db } from '../../../db'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { SecretsService } from '../../cloud/secrets/secrets.service'
import type { SecretDto } from '../../cloud/secrets/secrets.types'
import { AccountsService } from './accounts.service'
import type { AccountSecret, SandboxAccessTokenDto, SandboxAccountsDto } from './accounts.types'
import { EAuthKind } from './accounts.types'
import { BrokerService } from './broker.service'

/**
 * The secret names the in-sandbox serve process may resolve through the broker: the keyed
 * web-search backends (BACKEND_TRAITS entries with a keyLabel in packages/core/src/web/search.ts,
 * prefixed `search.`) plus `decisions.token`, the System-1 decision key the factory identity
 * carries per org. Keep in lockstep with WARM_SECRET_NAMES in
 * packages/harness/src/serve/serve-secrets-store.ts — a name the serve store warms but this list
 * refuses breaks every cloud session's web search.
 */
const BROKERABLE_SECRET_NAMES: readonly string[] = [
  'search.brave',
  'search.exa',
  'search.jina',
  'search.searxng',
  'search.tavily',
  'decisions.token',
]

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

  /**
   * Fail closed: the broker resolves only the secret names a serve process legitimately asks
   * for — the keyed web-search backends and the decision-model token the serve secrets store
   * warms on boot (packages/harness/src/serve/serve-secrets-store.ts). A sandbox token is
   * readable by any process in its sandbox, so a request naming anything else is the GH-198
   * shape: probing the owner's store through a machine credential. The whole request refuses
   * rather than serving the listed names and dropping the rest, so a misconfigured client fails
   * loudly instead of silently running without a key it asked for.
   */
  async namedSecrets(args: { userId: string; names: string[] }): Promise<SecretDto[]> {
    for (const name of args.names) {
      if (!BROKERABLE_SECRET_NAMES.includes(name)) {
        throw new BadRequestException(
          'the broker resolves only the secrets a serve process needs (web-search backends, decisions token)',
        )
      }
    }
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

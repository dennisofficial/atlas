import {
  accountSchema,
  chooseAccount,
  CredentialPort,
  EAccountChoice,
  EAuthKind,
  EAuthProvider,
  toAccountId,
  type Account,
  type Credential,
  type CredentialRequest,
} from '@dltech/atlas-harness/titling'
import { revisionOf, storedAccountSchema, type CredentialRevision } from '@dltech/atlas-core'
import type { AccountLease } from '@dltech/atlas-wire'
import type { OauthConnectionsService } from '../../platform/oauth-connections/oauth-connections.service'

export const accountsOf = (lease: AccountLease): Account[] =>
  lease.accounts.flatMap((stored) => {
    const parsed = accountSchema.safeParse(stored)
    return parsed.success ? [parsed.data] : []
  })

const revisionFor = (stored: AccountLease['accounts'][number]): CredentialRevision | undefined => {
  const parsed = storedAccountSchema.safeParse({
    ...stored,
    ...(stored.secretVersion === undefined ? {} : { authorizationRevision: stored.secretVersion }),
  })
  return parsed.success ? revisionOf(parsed.data) : undefined
}

export class ApiCredentialPort extends CredentialPort {
  private readonly rejected = new Map<string, string>()

  constructor(
    private readonly args: {
      userId: string
      lease: AccountLease
      oauth: Pick<OauthConnectionsService, 'issueAccessToken'>
    },
  ) {
    super()
  }

  async read(request?: CredentialRequest): Promise<Credential> {
    const provider = request?.provider ?? EAuthProvider.Anthropic
    const activeId = this.args.lease.active.find(
      (pointer) => pointer.provider === provider,
    )?.accountId
    const preferred =
      request?.accountId ?? (activeId === undefined ? undefined : toAccountId(activeId))
    const choice = chooseAccount({
      accounts: accountsOf(this.args.lease),
      provider,
      preferred,
    })
    if (choice.type !== EAccountChoice.Chosen) throw new Error(`no ${provider} account`)

    const { account } = choice
    const stored = this.args.lease.accounts.find((candidate) => candidate.id === account.id)
    const secret = stored?.secret
    const revision = stored === undefined ? undefined : revisionFor(stored)
    const stamp = revision === undefined ? {} : { revision }
    if (secret === undefined) throw new Error(`account ${account.id} has no secret`)
    if (secret.kind === EAuthKind.ApiKey) {
      return {
        kind: EAuthKind.ApiKey,
        accountId: account.id,
        apiKey: secret.apiKey,
        ...stamp,
      }
    }

    const connectionId = secret.authority?.connectionId
    if (connectionId === undefined) {
      return {
        kind: EAuthKind.Oauth,
        accountId: account.id,
        accessToken: secret.tokens.accessToken,
        expiresAt: secret.tokens.expiresAt,
        ...(secret.tokens.accountId === undefined
          ? {}
          : { providerAccountId: secret.tokens.accountId }),
        ...stamp,
      }
    }
    const rejectedToken = this.rejected.get(account.id)
    const issued = await this.args.oauth.issueAccessToken({
      userId: this.args.userId,
      connectionId,
      ...(rejectedToken === undefined ? {} : { rejectedAccessToken: rejectedToken }),
    })
    return {
      kind: EAuthKind.Oauth,
      accountId: account.id,
      accessToken: issued.accessToken,
      expiresAt: issued.expiresAt,
      ...(issued.providerAccountId === undefined
        ? {}
        : { providerAccountId: issued.providerAccountId }),
      ...stamp,
    }
  }

  async discard(credential: Credential): Promise<void> {
    if (credential.kind === EAuthKind.Oauth)
      this.rejected.set(credential.accountId, credential.accessToken)
  }
}

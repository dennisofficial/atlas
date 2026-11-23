import { CredentialPort, EAuthKind, toAccountId, type Credential } from '@dltech/atlas-core'
import { accountCredentialOf } from '@dltech/atlas-credentials'
import type { SecretCipher } from '@dltech/atlas-pods/config/secret-cipher'

import { CredentialError, ECredentialFailure } from '../model/credential-error'
import type { ModelTokenService } from '../tokens/model-token-service'
import type { UsageAccountRow } from './usage-accounts'

export class PlanCredential extends CredentialPort {
  constructor(
    private readonly args: {
      userId: string
      row: UsageAccountRow
      cipher: Pick<SecretCipher, 'decrypt'>
      tokens: Pick<ModelTokenService, 'issue'>
    },
  ) {
    super()
  }

  async read(): Promise<Credential> {
    const credential = accountCredentialOf({
      row: this.args.row,
      unseal: (sealed) => this.args.cipher.decrypt(sealed),
    })
    if (credential === undefined) throw failure('the account has no usable secret')
    if (credential.kind === 'api-key') {
      return {
        kind: EAuthKind.ApiKey,
        accountId: toAccountId(this.args.row.id),
        apiKey: credential.apiKey,
      }
    }
    if (credential.connectionId === undefined) throw failure('the account has no cloud connection')
    const issued = await this.args.tokens.issue({
      userId: this.args.userId,
      connectionId: credential.connectionId,
    })
    return {
      kind: EAuthKind.Oauth,
      accountId: toAccountId(this.args.row.id),
      accessToken: issued.accessToken,
      expiresAt: issued.expiresAt,
      ...(issued.providerAccountId === undefined
        ? {}
        : { providerAccountId: issued.providerAccountId }),
    }
  }

  discard(): Promise<void> {
    return Promise.resolve()
  }
}

const failure = (message: string): CredentialError =>
  new CredentialError({ failure: ECredentialFailure.NotFound, message })

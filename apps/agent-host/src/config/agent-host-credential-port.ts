import {
  CredentialPort,
  EAuthKind,
  toAccountId,
  type Credential,
  type CredentialRequest,
} from '@dltech/atlas-core'

import type { AgentHostApi } from './agent-host-api'
import type { ModelConfig } from './agent-host-config'

export class CredentialsUnavailableError extends Error {
  constructor(public readonly gap: string) {
    super(`model credentials unavailable: ${gap}`)
    this.name = 'CredentialsUnavailableError'
  }
}

type ModelBlock = ModelConfig
type Configured = Extract<ModelBlock, { configured: true }>

type OauthLease = { accessToken: string; refreshAfterMs: number }

export class AgentHostCredentialPort extends CredentialPort {
  private oauthLease: OauthLease | undefined
  private rejectedAccessToken: string | undefined

  constructor(
    private readonly args: {
      sessionId: string
      model: ModelBlock
      api: Pick<AgentHostApi, 'modelAccessToken'>
      now?: (() => number) | undefined
    },
  ) {
    super()
  }

  async read(_request?: CredentialRequest): Promise<Credential> {
    const model = this.args.model
    if (model.configured === false) throw new CredentialsUnavailableError(model.gap)
    if (model.credential.kind === 'api-key') {
      return {
        kind: EAuthKind.ApiKey,
        accountId: toAccountId(model.accountId),
        apiKey: model.credential.apiKey,
      }
    }
    return this.readOauth(model)
  }

  async discard(credential: Credential): Promise<void> {
    if (credential.kind === EAuthKind.Oauth) {
      this.rejectedAccessToken = credential.accessToken
      this.oauthLease = undefined
    }
  }

  private async readOauth(model: Configured): Promise<Credential> {
    const now = this.args.now ?? Date.now
    const lease = this.oauthLease
    if (lease !== undefined && now() < lease.refreshAfterMs) {
      return this.oauthCredential(model, lease.accessToken)
    }
    const connectionId =
      model.credential.kind === 'oauth' ? model.credential.connectionId : undefined
    if (connectionId === undefined) throw new CredentialsUnavailableError('no oauth connection')
    const issued = await this.args.api.modelAccessToken({
      sessionId: this.args.sessionId,
      connectionId,
      ...(this.rejectedAccessToken === undefined
        ? {}
        : { rejectedAccessToken: this.rejectedAccessToken }),
    })
    this.rejectedAccessToken = undefined
    this.oauthLease = {
      accessToken: issued.accessToken,
      refreshAfterMs: Date.parse(issued.refreshAfter),
    }
    return this.oauthCredential(model, issued.accessToken)
  }

  private oauthCredential(model: Configured, accessToken: string): Credential {
    return {
      kind: EAuthKind.Oauth,
      accountId: toAccountId(model.accountId),
      accessToken,
      expiresAt:
        this.oauthLease === undefined ? '' : new Date(this.oauthLease.refreshAfterMs).toISOString(),
    }
  }
}

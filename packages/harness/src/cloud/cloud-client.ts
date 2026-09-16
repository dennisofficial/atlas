import {
  accountIdSchema,
  accountSchema,
  storedAccountSchema,
  type Account,
  type AccountDraft,
  type AccountId,
  type AccountSecret,
  type EAccountStatus,
  type EAuthProvider,
  type StoredAccount,
} from '@dltech/atlas-core'
import { z } from 'zod'

import { mcpSpecSchema, type McpTransport, type ParsedMcpSpec } from '../mcp/config/specs'
import type { CloudSession } from './cloud-session'
import { cloudRequest } from './cloud-transport'
import {
  githubConnectPollOutcomeFrom,
  githubConnectPollResponseSchema,
  githubConnectTicketSchema,
  githubStateResponseSchema,
  githubTokenResponseSchema,
  type GithubConnectPollOutcome,
  type GithubConnectTicket,
  type GithubConnection,
} from './github-connect'

export { CloudError } from './cloud-transport'

const activeAccountResponseSchema = z.object({ accountId: accountIdSchema.nullable() })

const accessTokenResponseSchema = z.strictObject({
  accessToken: z.string().min(1),
  expiresAt: z.string().nullable(),
})

export type BrokeredAccessToken = z.infer<typeof accessTokenResponseSchema>

const cloudSecretSchema = z.strictObject({
  name: z.string().min(1),
  value: z.string(),
  updatedAt: z.string(),
})

export type CloudSecret = z.infer<typeof cloudSecretSchema>

const cloudMcpServerWireSchema = z.strictObject({
  name: mcpSpecSchema.shape.name,
  transport: mcpSpecSchema.shape.transport,
  disabled: mcpSpecSchema.shape.disabled,
  trusted: mcpSpecSchema.shape.trusted,
  updatedAt: z.string(),
})

export type CloudMcpServer = ParsedMcpSpec & { updatedAt: string }

export class CloudClient {
  private readonly url: string
  private readonly token: string
  private readonly clientVersion: string
  private readonly fetchFn: typeof fetch

  constructor(args: {
    url: string
    token: string
    clientVersion?: string
    fetchFn?: typeof fetch
  }) {
    this.url = args.url.replace(/\/+$/, '')
    this.token = args.token
    this.clientVersion = args.clientVersion ?? 'dev'
    this.fetchFn = args.fetchFn ?? fetch
  }

  get baseUrl(): string {
    return this.url
  }

  async health(): Promise<boolean> {
    try {
      const response = await this.fetchFn(`${this.url}/v1/health`, {
        headers: { 'atlas-client-version': this.clientVersion },
      })
      return response.ok
    } catch {
      return false
    }
  }

  async listAccounts(): Promise<readonly Account[]> {
    const body = await this.request({ method: 'GET', path: '/v1/accounts' })
    return z.array(accountSchema).parse(body)
  }

  async readAccount(args: { accountId: AccountId }): Promise<StoredAccount | undefined> {
    const body = await this.request({
      method: 'GET',
      path: `/v1/accounts/${args.accountId}`,
      allowMissing: true,
    })
    if (body === undefined) return undefined

    return storedAccountSchema.parse(body)
  }

  async addAccount(args: { draft: AccountDraft }): Promise<Account> {
    const { draft } = args
    const body = await this.request({
      method: 'POST',
      path: '/v1/accounts',
      body: {
        provider: draft.provider,
        label: draft.label,
        secret: draft.secret,
        origin: draft.origin,
        ...(draft.email === undefined ? {} : { email: draft.email }),
        ...(draft.subscription === undefined ? {} : { subscription: draft.subscription }),
        ...(draft.importedFrom === undefined ? {} : { importedFrom: draft.importedFrom }),
      },
    })

    return accountSchema.parse(body)
  }

  async replaceAccountSecret(args: {
    accountId: AccountId
    secret: AccountSecret
  }): Promise<void> {
    await this.request({
      method: 'PUT',
      path: `/v1/accounts/${args.accountId}/secret`,
      body: { secret: args.secret },
    })
  }

  async setAccountStatus(args: {
    accountId: AccountId
    status: EAccountStatus
  }): Promise<void> {
    await this.request({
      method: 'PATCH',
      path: `/v1/accounts/${args.accountId}/status`,
      body: { status: args.status },
    })
  }

  async removeAccount(args: { accountId: AccountId }): Promise<void> {
    await this.request({ method: 'DELETE', path: `/v1/accounts/${args.accountId}` })
  }

  async accessToken(args: {
    accountId: AccountId
    rejectedAccessToken?: string
  }): Promise<BrokeredAccessToken> {
    const body = await this.request({
      method: 'POST',
      path: `/v1/accounts/${args.accountId}/access-token`,
      body:
        args.rejectedAccessToken === undefined
          ? {}
          : { rejectedAccessToken: args.rejectedAccessToken },
    })
    return accessTokenResponseSchema.parse(body)
  }

  async setActiveAccount(args: {
    provider: EAuthProvider
    accountId: AccountId
  }): Promise<void> {
    await this.request({
      method: 'PUT',
      path: '/v1/accounts/active',
      body: { provider: args.provider, accountId: args.accountId },
    })
  }

  async activeAccount(args: { provider: EAuthProvider }): Promise<AccountId | undefined> {
    const body = await this.request({
      method: 'GET',
      path: `/v1/accounts/active/${args.provider}`,
    })
    const parsed = activeAccountResponseSchema.parse(body)

    return parsed.accountId ?? undefined
  }

  async listSecrets(): Promise<readonly CloudSecret[]> {
    const body = await this.request({ method: 'GET', path: '/v1/secrets' })
    return z.strictObject({ secrets: z.array(cloudSecretSchema) }).parse(body).secrets
  }

  async putSecret(args: { name: string; value: string }): Promise<void> {
    await this.request({
      method: 'PUT',
      path: `/v1/secrets/${args.name}`,
      body: { value: args.value },
    })
  }

  async deleteSecret(args: { name: string }): Promise<void> {
    await this.request({ method: 'DELETE', path: `/v1/secrets/${args.name}` })
  }

  async listMcpServers(): Promise<readonly CloudMcpServer[]> {
    const body = await this.request({ method: 'GET', path: '/v1/mcp-servers' })
    const parsed = z.strictObject({ servers: z.array(cloudMcpServerWireSchema) }).parse(body)
    return parsed.servers.map((server) => {
      const { updatedAt, ...fields } = server
      return { ...mcpSpecSchema.parse(fields), updatedAt }
    })
  }

  async putMcpServer(args: {
    name: string
    transport?: McpTransport
    disabled?: boolean
    trusted?: boolean
  }): Promise<void> {
    await this.request({
      method: 'PUT',
      path: `/v1/mcp-servers/${args.name}`,
      body: {
        ...(args.transport === undefined ? {} : { transport: args.transport }),
        ...(args.disabled === undefined ? {} : { disabled: args.disabled }),
        ...(args.trusted === undefined ? {} : { trusted: args.trusted }),
      },
    })
  }

  async deleteMcpServer(args: { name: string }): Promise<void> {
    await this.request({ method: 'DELETE', path: `/v1/mcp-servers/${args.name}` })
  }

  async beginGithubConnect(): Promise<GithubConnectTicket> {
    const body = await this.request({ method: 'POST', path: '/v1/github/connect/begin' })
    return githubConnectTicketSchema.parse(body)
  }

  async pollGithubConnect(args: { deviceCode: string }): Promise<GithubConnectPollOutcome> {
    const body = await this.request({
      method: 'POST',
      path: '/v1/github/connect/poll',
      body: { deviceCode: args.deviceCode },
    })
    return githubConnectPollOutcomeFrom(githubConnectPollResponseSchema.parse(body))
  }

  async githubConnection(): Promise<GithubConnection | null> {
    const body = await this.request({ method: 'GET', path: '/v1/github' })
    const parsed = githubStateResponseSchema.parse(body)
    if (!parsed.connected) return null
    return { login: parsed.login, scopes: parsed.scopes, connectedAt: parsed.connectedAt }
  }

  async githubToken(): Promise<string | undefined> {
    const body = await this.request({
      method: 'GET',
      path: '/v1/github/token',
      allowMissing: true,
    })
    if (body === undefined) return undefined
    return githubTokenResponseSchema.parse(body).token
  }

  async disconnectGithub(): Promise<void> {
    await this.request({ method: 'DELETE', path: '/v1/github' })
  }

  private request(args: {
    method: string
    path: string
    body?: unknown
    allowMissing?: boolean
  }): Promise<unknown> {
    return cloudRequest({
      url: this.url,
      token: this.token,
      clientVersion: this.clientVersion,
      fetchFn: this.fetchFn,
      method: args.method,
      path: args.path,
      ...(args.body === undefined ? {} : { body: args.body }),
      ...(args.allowMissing === undefined ? {} : { allowMissing: args.allowMissing }),
    })
  }
}

export const cloudClientFor = (args: {
  session: CloudSession
  clientVersion?: string
  fetchFn?: typeof fetch
}): CloudClient =>
  new CloudClient({
    url: args.session.url,
    token: args.session.token,
    ...(args.clientVersion === undefined ? {} : { clientVersion: args.clientVersion }),
    ...(args.fetchFn === undefined ? {} : { fetchFn: args.fetchFn }),
  })

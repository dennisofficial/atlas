import {
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
import type { ApiClient } from '@dltech/atlas-api-router'
import type { Project } from '@dltech/atlas-wire'
import { mcpTransportSchema as mcpTransportWireSchema } from '@dltech/atlas-wire/web'
import { z } from 'zod'

import { mcpSpecSchema, type McpTransport } from '../mcp/config/specs'
import { cloudCall, createHarnessApiClient } from './api-trpc-client'
import type { CloudSession } from './cloud-session'
import { createProjectVia, listProjectsVia, type ProjectInput } from './cloud-projects'
import { cloudRequest } from './cloud-transport'
import {
  beginGithubConnectVia,
  disconnectGithubVia,
  dismissGithubAppInstallNoticeVia,
  githubConnectionVia,
  githubTokenVia,
  pollGithubConnectVia,
} from './cloud-github'
import type {
  GithubConnectPollOutcome,
  GithubConnectTicket,
  GithubConnection,
} from './github-connect'

export { CloudError } from './cloud-transport'

import {
  accessTokenResponseSchema,
  activeAccountResponseSchema,
  cloudMcpServerWireSchema,
  cloudSecretSchema,
  cloudSettingSchema,
  type BrokeredAccessToken,
  type CloudMcpServer,
  type CloudSecret,
  type CloudSetting,
} from './cloud-resource-schemas'

export type {
  BrokeredAccessToken,
  CloudMcpServer,
  CloudSecret,
  CloudSetting,
} from './cloud-resource-schemas'

export class CloudClient {
  private readonly url: string
  private readonly token: string
  private readonly clientVersion: string
  private readonly fetchFn: typeof fetch
  private readonly api: ApiClient

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
    this.api = createHarnessApiClient({
      url: this.url,
      token: this.token,
      clientVersion: this.clientVersion,
      fetchFn: this.fetchFn,
    })
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
    const body = await cloudCall(this.api.accounts.list.query())
    return z.array(accountSchema).parse(body)
  }

  async readAccount(args: { accountId: AccountId }): Promise<StoredAccount | undefined> {
    const body = await cloudCall(this.api.accounts.get.query({ accountId: args.accountId }), {
      allowMissing: true,
    })
    if (body === undefined) return undefined

    return storedAccountSchema.parse(body)
  }

  async addAccount(args: { draft: AccountDraft }): Promise<Account> {
    const { draft } = args
    const body = await cloudCall(
      this.api.accounts.create.mutate({
        provider: draft.provider,
        label: draft.label,
        secret: draft.secret,
        origin: draft.origin,
        ...(draft.email === undefined ? {} : { email: draft.email }),
        ...(draft.subscription === undefined ? {} : { subscription: draft.subscription }),
        ...(draft.importedFrom === undefined ? {} : { importedFrom: draft.importedFrom }),
      }),
    )

    return accountSchema.parse(body)
  }

  async replaceAccountSecret(args: { accountId: AccountId; secret: AccountSecret }): Promise<void> {
    await cloudCall(
      this.api.accounts.replaceSecret.mutate({ accountId: args.accountId, secret: args.secret }),
    )
  }

  async setAccountStatus(args: { accountId: AccountId; status: EAccountStatus }): Promise<void> {
    await cloudCall(
      this.api.accounts.setStatus.mutate({ accountId: args.accountId, status: args.status }),
    )
  }

  async removeAccount(args: { accountId: AccountId }): Promise<void> {
    await cloudCall(this.api.accounts.remove.mutate({ accountId: args.accountId }))
  }

  async accessToken(args: {
    accountId: AccountId
    rejectedAccessToken?: string
  }): Promise<BrokeredAccessToken> {
    const body = await this.request({
      method: 'POST',
      path: `/v1/accounts/${encodeURIComponent(args.accountId)}/access-token`,
      body:
        args.rejectedAccessToken === undefined
          ? {}
          : { rejectedAccessToken: args.rejectedAccessToken },
    })
    return accessTokenResponseSchema.parse(body)
  }

  async setActiveAccount(args: { provider: EAuthProvider; accountId: AccountId }): Promise<void> {
    await cloudCall(
      this.api.accounts.setActive.mutate({ provider: args.provider, accountId: args.accountId }),
    )
  }

  async activeAccount(args: { provider: EAuthProvider }): Promise<AccountId | undefined> {
    const body = await cloudCall(this.api.accounts.active.query({ provider: args.provider }))
    const parsed = activeAccountResponseSchema.parse(body)

    return parsed.accountId ?? undefined
  }

  async listSecrets(): Promise<readonly CloudSecret[]> {
    const body = await cloudCall(this.api.secrets.list.query())
    return z.strictObject({ secrets: z.array(cloudSecretSchema) }).parse(body).secrets
  }

  async putSecret(args: { name: string; value: string }): Promise<void> {
    await cloudCall(this.api.secrets.set.mutate({ name: args.name, value: args.value }))
  }

  async deleteSecret(args: { name: string }): Promise<void> {
    await cloudCall(this.api.secrets.remove.mutate({ name: args.name }))
  }

  async listSettings(): Promise<readonly CloudSetting[]> {
    const body = await cloudCall(this.api.settings.list.query())
    return z.strictObject({ settings: z.array(cloudSettingSchema) }).parse(body).settings
  }

  async setSetting(args: { key: string; value: string }): Promise<void> {
    await cloudCall(this.api.settings.set.mutate({ key: args.key, value: args.value }))
  }

  async deleteSetting(args: { key: string }): Promise<void> {
    await cloudCall(this.api.settings.remove.mutate({ key: args.key }))
  }

  async listMcpServers(): Promise<readonly CloudMcpServer[]> {
    const body = await cloudCall(this.api.mcpServers.list.query())
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
  }): Promise<void> {
    await cloudCall(
      this.api.mcpServers.put.mutate({
        name: args.name,
        ...(args.transport === undefined
          ? {}
          : { transport: mcpTransportWireSchema.parse(args.transport) }),
        ...(args.disabled === undefined ? {} : { disabled: args.disabled }),
      }),
    )
  }

  async deleteMcpServer(args: { name: string }): Promise<void> {
    await cloudCall(this.api.mcpServers.remove.mutate({ name: args.name }))
  }

  beginGithubConnect(): Promise<GithubConnectTicket> {
    return beginGithubConnectVia((args) => this.request(args))
  }

  pollGithubConnect(args: { deviceCode: string }): Promise<GithubConnectPollOutcome> {
    return pollGithubConnectVia({
      request: (call) => this.request(call),
      deviceCode: args.deviceCode,
    })
  }

  dismissGithubAppInstallNotice(args: { repoFullName: string }): Promise<void> {
    return dismissGithubAppInstallNoticeVia({
      request: (call) => this.request(call),
      repoFullName: args.repoFullName,
    })
  }

  githubConnection(): Promise<GithubConnection | null> {
    return githubConnectionVia((args) => this.request(args))
  }

  githubToken(): Promise<string | undefined> {
    return githubTokenVia((args) => this.request(args))
  }

  disconnectGithub(): Promise<void> {
    return disconnectGithubVia((args) => this.request(args))
  }

  listProjects(): Promise<Project[]> {
    return listProjectsVia(this.api)
  }

  createProject(input: ProjectInput): Promise<Project> {
    return createProjectVia({ api: this.api, input })
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

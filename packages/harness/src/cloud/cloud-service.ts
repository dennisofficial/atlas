import {
  AccountStorePort,
  EAuthProvider,
  type AccountDraft,
  type AccountId,
} from '@dltech/atlas-core'
import { z } from 'zod'

import { FileMcpSource } from '../mcp/config/sources'
import type { FileSecretsStore } from '../secrets/file-secrets-store'
import { CloudClient, CloudError } from './cloud-client'
import type { CloudSession, CloudSessionStore } from './cloud-session'
import {
  beginCloudLogin,
  type CloudLoginTicket,
} from './device-login'
import { RemoteAccountStore } from './remote-account-store'

const getSessionResponseSchema = z.object({
  user: z.object({ email: z.string().optional() }),
})

export type CloudLoginResult = {
  session: CloudSession
  imported: number
  importedSecrets: number
  importedMcp: number
}

export class CloudService {
  private readonly sessions: CloudSessionStore
  private readonly localAccounts: AccountStorePort
  private readonly localSecrets: FileSecretsStore | undefined
  private readonly defaultUrl: string
  private readonly fetchFn: typeof fetch
  private cached: { token: string; client: CloudClient } | undefined

  constructor(args: {
    sessions: CloudSessionStore
    localAccounts: AccountStorePort
    defaultUrl: string
    localSecrets?: FileSecretsStore
    fetchFn?: typeof fetch
  }) {
    this.sessions = args.sessions
    this.localAccounts = args.localAccounts
    this.localSecrets = args.localSecrets
    this.defaultUrl = args.defaultUrl
    this.fetchFn = args.fetchFn ?? fetch
  }

  session(): CloudSession | null {
    return this.sessions.read()
  }

  client(): CloudClient | null {
    const session = this.sessions.read()
    if (session === null) {
      this.cached = undefined
      return null
    }

    if (this.cached?.token !== session.token) {
      this.cached = {
        token: session.token,
        client: new CloudClient({ url: session.url, token: session.token, fetchFn: this.fetchFn }),
      }
    }

    return this.cached.client
  }

  async beginLogin(args?: { url?: string }): Promise<CloudLoginTicket> {
    const url = args?.url ?? this.defaultUrl

    const reachable = await new CloudClient({ url, token: '', fetchFn: this.fetchFn }).health()
    if (!reachable)
      throw new CloudError({
        status: 0,
        message: `The Atlas Cloud API at ${url} is unreachable — is the cloud API running?`,
      })

    return beginCloudLogin({ url, fetchFn: this.fetchFn })
  }

  async finishLogin(args: {
    ticket: CloudLoginTicket
    token: string
  }): Promise<CloudLoginResult> {
    const { ticket, token } = args
    const email = await this.readSignedInEmail({ url: ticket.url, token })

    const session: CloudSession = { url: ticket.url, token, email }
    this.sessions.write(session)

    const client = new CloudClient({ url: ticket.url, token, fetchFn: this.fetchFn })

    try {
      const imported = await this.importLocalAccounts({ client })
      const importedSecrets = await this.importLocalSecrets({ client })
      const importedMcp = await this.importLocalMcp({ client })
      return { session, imported, importedSecrets, importedMcp }
    } catch (cause) {
      throw new CloudError({
        status: cause instanceof CloudError ? cause.status : 0,
        message: `Signed in to ${ticket.url}, but copying the local accounts, secrets and mcp servers into the cloud failed: ${cause instanceof Error ? cause.message : String(cause)}. The sign-in is kept; the copy may be incomplete.`,
      })
    }
  }

  logout(): void {
    this.sessions.clear()
  }

  private async readSignedInEmail(args: { url: string; token: string }): Promise<string | null> {
    const url = args.url.replace(/\/+$/, '')
    const response = await this.fetchFn(`${url}/api/auth/get-session`, {
      headers: { authorization: `Bearer ${args.token}` },
    })

    if (!response.ok)
      throw new CloudError({
        status: response.status,
        message: `The Atlas Cloud API at ${url} would not confirm the new sign-in (${response.status}).`,
      })

    const parsed = getSessionResponseSchema.safeParse(await response.json())
    return parsed.success ? (parsed.data.user.email ?? null) : null
  }

  private async importLocalAccounts(args: { client: CloudClient }): Promise<number> {
    const remote = new RemoteAccountStore({ client: args.client })
    const existing = await remote.list()
    if (existing.length > 0) return 0

    const local = await this.localAccounts.list()
    const remoteIds = new Map<AccountId, AccountId>()

    for (const account of local) {
      const stored = await this.localAccounts.read(account.id)
      if (stored === undefined) continue

      const draft: AccountDraft = {
        provider: stored.provider,
        label: stored.label,
        secret: stored.secret,
        origin: stored.origin,
        ...(stored.email === undefined ? {} : { email: stored.email }),
        ...(stored.subscription === undefined ? {} : { subscription: stored.subscription }),
        ...(stored.importedFrom === undefined ? {} : { importedFrom: stored.importedFrom }),
      }
      const added = await remote.add(draft)
      remoteIds.set(account.id, added.id)
    }

    await this.copyActivePointers({ remote, remoteIds })
    return remoteIds.size
  }

  private async importLocalSecrets(args: { client: CloudClient }): Promise<number> {
    if (this.localSecrets === undefined) return 0

    const existing = await args.client.listSecrets()
    if (existing.length > 0) return 0

    let imported = 0
    for (const name of this.localSecrets.names()) {
      const value = this.localSecrets.read(name)
      if (value === undefined) continue
      await args.client.putSecret({ name, value })
      imported += 1
    }
    return imported
  }

  private async importLocalMcp(args: { client: CloudClient }): Promise<number> {
    const existing = await args.client.listMcpServers()
    if (existing.length > 0) return 0

    const read = await FileMcpSource.user().load()
    let imported = 0
    for (const spec of read.specs) {
      await args.client.putMcpServer({
        name: spec.name,
        ...(spec.transport === undefined ? {} : { transport: spec.transport }),
        ...(spec.disabled === undefined ? {} : { disabled: spec.disabled }),
        ...(spec.trusted === undefined ? {} : { trusted: spec.trusted }),
      })
      imported += 1
    }
    return imported
  }

  private async copyActivePointers(args: {
    remote: RemoteAccountStore
    remoteIds: Map<AccountId, AccountId>
  }): Promise<void> {
    for (const provider of Object.values(EAuthProvider)) {
      const active: AccountId | undefined = await this.localAccounts.activeFor(provider)
      if (active === undefined) continue

      const remoteId = args.remoteIds.get(active)
      if (remoteId === undefined) continue

      await args.remote.setActive({ provider, accountId: remoteId })
    }
  }
}

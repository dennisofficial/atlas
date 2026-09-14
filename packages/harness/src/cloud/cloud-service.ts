import {
  AccountStorePort,
  EAuthProvider,
  type AccountDraft,
  type AccountId,
} from '@dltech/atlas-core'
import { z } from 'zod'

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

export class CloudService {
  private readonly sessions: CloudSessionStore
  private readonly localAccounts: AccountStorePort
  private readonly defaultUrl: string
  private readonly fetchFn: typeof fetch

  constructor(args: {
    sessions: CloudSessionStore
    localAccounts: AccountStorePort
    defaultUrl: string
    fetchFn?: typeof fetch
  }) {
    this.sessions = args.sessions
    this.localAccounts = args.localAccounts
    this.defaultUrl = args.defaultUrl
    this.fetchFn = args.fetchFn ?? fetch
  }

  session(): CloudSession | null {
    return this.sessions.read()
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
  }): Promise<{ session: CloudSession; imported: number }> {
    const { ticket, token } = args
    const email = await this.readSignedInEmail({ url: ticket.url, token })

    const session: CloudSession = { url: ticket.url, token, email }
    this.sessions.write(session)

    const client = new CloudClient({ url: ticket.url, token, fetchFn: this.fetchFn })

    try {
      const imported = await this.importLocalAccounts({ client })
      return { session, imported }
    } catch (cause) {
      throw new CloudError({
        status: cause instanceof CloudError ? cause.status : 0,
        message: `Signed in to ${ticket.url}, but copying the local accounts into the cloud failed: ${cause instanceof Error ? cause.message : String(cause)}. The sign-in is kept; the accounts may be incomplete.`,
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

import { existsSync, renameSync } from 'node:fs'

import {
  AccountStorePort,
  EAuthProvider,
  type AccountDraft,
  type AccountId,
} from '@dltech/atlas-core'
import { z } from 'zod'

import { atlasVaultFile } from '../credentials/paths'
import { FileMcpSource } from '../mcp/config/sources'
import type { FileSecretsStore } from '../secrets/file-secrets-store'
import { atlasSecretsFile } from '../secrets/paths'
import { userMcpFile } from '../settings/paths'
import { CloudClient, CloudError, cloudClientFor } from './cloud-client'
import type { CloudSession, CloudSessionStore } from './cloud-session'
import {
  beginCloudLogin,
  type CloudLoginTicket,
} from './device-login'
import { downloadAndPurgeCloudData, type CloudPurgeResult } from './download-purge'
import { RemoteAccountStore } from './remote-account-store'
import { fileSignInOffer, type SignInOffer } from './sign-in-offer'
import { UserContextClient } from './user-context-client'

const getSessionResponseSchema = z.object({
  user: z.object({ email: z.string().optional() }),
})

export type CloudLoginResult = {
  session: CloudSession
  imported: number
  importedSecrets: number
  importedMcp: number
  archived: string[]
}

const isAbsentFile = (cause: unknown): boolean =>
  typeof cause === 'object' && cause !== null && Reflect.get(cause, 'code') === 'ENOENT'

const archiveIfPresent = (file: string): string | null => {
  const archived = `${file}.archived`
  try {
    renameSync(file, archived)
  } catch (cause) {
    if (isAbsentFile(cause)) return null
    throw cause
  }
  return archived
}

const archiveImportedLocalFiles = (): string[] =>
  [atlasVaultFile(), atlasSecretsFile(), userMcpFile()].flatMap((file) => {
    const archived = archiveIfPresent(file)
    return archived === null ? [] : [archived]
  })

/**
 * Sign-in moved the local files aside; sign-out hands them back, so a signed-out Atlas has its
 * accounts, secrets and mcp layer again. A live file already sitting at the path wins — the purge
 * flow writes fresh downloads there before clearing the session, and an archived snapshot must
 * never overwrite them.
 */
const restoreArchivedLocalFiles = (): void => {
  for (const file of [atlasVaultFile(), atlasSecretsFile(), userMcpFile()]) {
    if (existsSync(file)) continue
    try {
      renameSync(`${file}.archived`, file)
    } catch (cause) {
      if (!isAbsentFile(cause)) throw cause
    }
  }
}

export class CloudService {
  private readonly sessions: CloudSessionStore
  private readonly localAccounts: AccountStorePort
  private readonly localSecrets: FileSecretsStore | undefined
  private readonly defaultUrl: string
  private readonly clientVersion: string | undefined
  private readonly fetchFn: typeof fetch
  private readonly signInOffer: SignInOffer
  private cached: { token: string; client: CloudClient } | undefined

  constructor(args: {
    sessions: CloudSessionStore
    localAccounts: AccountStorePort
    defaultUrl: string
    localSecrets?: FileSecretsStore
    clientVersion?: string
    fetchFn?: typeof fetch
    signInOffer?: SignInOffer
  }) {
    this.sessions = args.sessions
    this.localAccounts = args.localAccounts
    this.localSecrets = args.localSecrets
    this.defaultUrl = args.defaultUrl
    this.clientVersion = args.clientVersion
    this.fetchFn = args.fetchFn ?? fetch
    this.signInOffer = args.signInOffer ?? fileSignInOffer()
  }

  private clientFor(args: { session: CloudSession }): CloudClient {
    return cloudClientFor({
      session: args.session,
      ...(this.clientVersion === undefined ? {} : { clientVersion: this.clientVersion }),
      fetchFn: this.fetchFn,
    })
  }

  session(): CloudSession | null {
    return this.sessions.read()
  }

  /**
   * The signed-out boot notice is an offer read once ever, not a per-boot nag — the marker lives
   * beside the vault so a never-signing-in operator is never asked twice.
   */
  signInOffered(): boolean {
    return this.signInOffer.offered()
  }

  markSignInOffered(): void {
    this.signInOffer.markOffered()
  }

  client(): CloudClient | null {
    const session = this.sessions.read()
    if (session === null) {
      this.cached = undefined
      return null
    }

    if (this.cached?.token !== session.token) {
      this.cached = { token: session.token, client: this.clientFor({ session }) }
    }

    return this.cached.client
  }

  async beginLogin(args?: { url?: string }): Promise<CloudLoginTicket> {
    const url = args?.url ?? this.defaultUrl

    const reachable = await new CloudClient({
      url,
      token: '',
      ...(this.clientVersion === undefined ? {} : { clientVersion: this.clientVersion }),
      fetchFn: this.fetchFn,
    }).health()
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

    const client = this.clientFor({ session })

    try {
      const imported = await this.importLocalAccounts({ client })
      const importedSecrets = await this.importLocalSecrets({ client })
      const importedMcp = await this.importLocalMcp({ client })
      const archived = archiveImportedLocalFiles()
      return { session, imported, importedSecrets, importedMcp, archived }
    } catch (cause) {
      throw new CloudError({
        status: cause instanceof CloudError ? cause.status : 0,
        message: `Signed in to ${ticket.url}, but copying the local accounts, secrets and mcp servers into the cloud failed: ${cause instanceof Error ? cause.message : String(cause)}. The sign-in is kept; the copy may be incomplete.`,
      })
    }
  }

  logout(): void {
    this.sessions.clear()
    restoreArchivedLocalFiles()
  }

  /**
   * Pulls everything the cloud holds into the local stores, deletes it server-side domain by
   * domain, then clears the session — a signed-in session serves the (now empty) remote stores,
   * so staying signed in would hide what just landed locally. A failure throws before the
   * session is touched, leaving the remaining domains in the cloud for a retry.
   */
  async downloadAndPurge(): Promise<CloudPurgeResult> {
    const session = this.sessions.read()
    if (session === null)
      throw new CloudError({
        status: 0,
        message: 'There is no Atlas Cloud sign-in to purge — sign in first.',
      })

    const client = this.clientFor({ session })
    const context = new UserContextClient({
      url: session.url,
      token: session.token,
      ...(this.clientVersion === undefined ? {} : { clientVersion: this.clientVersion }),
      fetchFn: this.fetchFn,
    })

    const result = await downloadAndPurgeCloudData({
      client,
      stores: { accounts: this.localAccounts, secrets: this.localSecrets, context },
    })
    this.sessions.clear()
    return result
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

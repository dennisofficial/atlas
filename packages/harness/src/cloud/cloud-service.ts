import type { AccountStorePort, SettingsStorePort, ThreadId } from '@dltech/atlas-core'
import { z } from 'zod'

import type { FileSecretsStore } from '../secrets/file-secrets-store'
import { CloudClient, CloudError, cloudClientFor } from './cloud-client'
import type { CloudSession, CloudSessionStore } from './cloud-session'
import { VercelCredentialStore } from './vercel-credential-store'
import { SessionsClient } from './sessions-client'
import { beginCloudLogin, type CloudLoginTicket } from './device-login'
import { restoreArchivedLocalFiles } from './local-recovery'
import { fileSignInOffer, type SignInOffer } from './sign-in-offer'
import { downloadCloudData } from './sync-download'
import { prepareSandboxOauth, type OauthHandoffCallback } from './cloud-oauth-sandbox'
import { uploadLocalSettings } from './sync-settings'
import { uploadLocalMcp, type CloudSyncCounts } from './upload-local'
import { fileLocalArchive, type LocalArchive } from './local-archive'
import { migrateLocalToCloud, type LocalMigration } from './migrate-local'
import { RemoteAccountStore } from './remote-account-store'

const getSessionResponseSchema = z.object({
  user: z.object({ email: z.string().optional() }),
})

const migrationFailed = (error: unknown): CloudError =>
  new CloudError({
    status: error instanceof CloudError ? error.status : 0,
    message: `Signed in to Atlas Cloud, but moving this machine's accounts and secrets up failed (${error instanceof Error ? error.message : String(error)}). They stay on this machine; retry with Upload in settings.`,
  })

export type CloudLoginResult = {
  session: CloudSession
}

export type SessionsClientFor = (args: {
  session: CloudSession
  clientVersion: string | undefined
}) => SessionsClient

export class CloudService {
  private readonly sessions: CloudSessionStore
  private readonly localAccounts: AccountStorePort
  private readonly accounts: AccountStorePort | undefined
  private readonly localSecrets: FileSecretsStore | undefined
  private readonly localSettings: SettingsStorePort | undefined
  private readonly defaultUrl: string
  private readonly clientVersion: string | undefined
  private readonly fetchFn: typeof fetch
  private readonly signInOffer: SignInOffer
  private readonly sessionsClientFor: SessionsClientFor | undefined
  private readonly handoffOauth: OauthHandoffCallback | undefined
  private readonly migrateOnSignIn: boolean
  private readonly archive: LocalArchive
  private readonly onMigrated: (() => Promise<void>) | undefined
  private cached: { token: string; client: CloudClient } | undefined
  private vercelStore: VercelCredentialStore | undefined

  constructor(args: {
    sessions: CloudSessionStore
    localAccounts: AccountStorePort
    accounts?: AccountStorePort
    defaultUrl: string
    localSecrets?: FileSecretsStore
    localSettings?: SettingsStorePort
    clientVersion?: string
    fetchFn?: typeof fetch
    signInOffer?: SignInOffer
    sessionsClientFor?: SessionsClientFor
    handoffOauth?: OauthHandoffCallback
    migrateOnSignIn?: boolean
    archive?: LocalArchive
    onMigrated?: () => Promise<void>
  }) {
    this.sessions = args.sessions
    this.localAccounts = args.localAccounts
    this.accounts = args.accounts
    this.localSecrets = args.localSecrets
    this.localSettings = args.localSettings
    this.defaultUrl = args.defaultUrl
    this.clientVersion = args.clientVersion
    this.fetchFn = args.fetchFn ?? fetch
    this.signInOffer = args.signInOffer ?? fileSignInOffer()
    this.sessionsClientFor = args.sessionsClientFor
    this.handoffOauth = args.handoffOauth
    this.migrateOnSignIn = args.migrateOnSignIn === true
    this.archive = args.archive ?? fileLocalArchive()
    this.onMigrated = args.onMigrated
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

  sessionsClient(args: { session: CloudSession }): SessionsClient {
    return (
      this.sessionsClientFor?.({
        session: args.session,
        clientVersion: this.clientVersion,
      }) ??
      new SessionsClient({
        url: args.session.url,
        token: args.session.token,
        ...(this.clientVersion === undefined ? {} : { clientVersion: this.clientVersion }),
        fetchFn: this.fetchFn,
      })
    )
  }

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
      this.cached = {
        token: session.token,
        client: this.clientFor({ session }),
      }
    }

    return this.cached.client
  }

  vercel(): VercelCredentialStore {
    this.vercelStore ??= new VercelCredentialStore(() => this.client())
    return this.vercelStore
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

  async finishLogin(args: { ticket: CloudLoginTicket; token: string }): Promise<CloudLoginResult> {
    const { ticket, token } = args
    const email = await this.readSignedInEmail({ url: ticket.url, token })

    const session: CloudSession = { url: ticket.url, token, email }
    this.sessions.write(session)
    if (!this.migrateOnSignIn) {
      await this.handoffOauth?.(session)
      return { session }
    }

    const migrationFailure = await this.migrateLocal().then(
      () => undefined,
      (error: unknown) => error,
    )
    await this.handoffOauth?.(session)
    if (migrationFailure !== undefined) throw migrationFailed(migrationFailure)

    return { session }
  }

  async migrateLocal(): Promise<LocalMigration> {
    const client = this.requireClient()
    const moved = await migrateLocalToCloud({
      client,
      cloud: new RemoteAccountStore({ client }),
      local: this.localAccounts,
      localSecrets: this.localSecrets,
      archive: this.archive,
    })
    if (moved.accounts + moved.secrets > 0) await this.onMigrated?.()
    return moved
  }

  logout(): void {
    this.sessions.clear()
    restoreArchivedLocalFiles()
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

  async prepareSandboxOauth(args: {
    threadId: ThreadId
    token: string
    serveUrl: string
    model?: string | undefined
  }): Promise<void> {
    await prepareSandboxOauth({
      accounts: this.accounts ?? this.localAccounts,
      session: this.session(),
      handoffOauth: this.handoffOauth,
      registration: {
        threadId: args.threadId,
        token: args.token,
        serveUrl: args.serveUrl,
      },
      ...(args.model === undefined ? {} : { model: args.model }),
      clientVersion: this.clientVersion ?? 'dev',
      fetchFn: this.fetchFn,
    })
  }

  async uploadLocalToCloud(): Promise<CloudSyncCounts> {
    const client = this.requireClient()
    const moved = await this.migrateLocal()
    const session = this.session()
    if (session !== null) await this.handoffOauth?.(session)
    return {
      accounts: moved.accounts,
      secrets: moved.secrets,
      mcpServers: await uploadLocalMcp({ client }),
      settings: await uploadLocalSettings({
        client,
        localSettings: this.localSettings,
      }),
    }
  }

  async downloadCloudToLocal(): Promise<CloudSyncCounts> {
    const client = this.requireClient()
    const result = await downloadCloudData({
      client,
      stores: {
        accounts: this.localAccounts,
        secrets: this.localSecrets,
        settings: this.localSettings,
      },
    })
    const session = this.session()
    if (session !== null) await this.handoffOauth?.(session)
    return result
  }

  private requireClient(): CloudClient {
    const session = this.sessions.read()
    if (session === null)
      throw new CloudError({
        status: 0,
        message: 'There is no Atlas Cloud sign-in — sign in first.',
      })
    return this.clientFor({ session })
  }
}

import type { AccountStorePort, SettingsStorePort } from '@dltech/atlas-core'
import { z } from 'zod'

import type { FileSecretsStore } from '../secrets/file-secrets-store'
import { CloudClient, CloudError, cloudClientFor } from './cloud-client'
import type { CloudSession, CloudSessionStore } from './cloud-session'
import { SessionsClient } from './sessions-client'
import { beginCloudLogin, type CloudLoginTicket } from './device-login'
import { restoreArchivedLocalFiles } from './local-recovery'
import { fileSignInOffer, type SignInOffer } from './sign-in-offer'
import { downloadCloudData } from './sync-download'
import { uploadLocalSettings } from './sync-settings'
import {
  uploadLocalAccounts,
  uploadLocalMcp,
  uploadLocalSecrets,
  type CloudSyncCounts,
} from './upload-local'

const getSessionResponseSchema = z.object({
  user: z.object({ email: z.string().optional() }),
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
  private readonly localSecrets: FileSecretsStore | undefined
  private readonly localSettings: SettingsStorePort | undefined
  private readonly defaultUrl: string
  private readonly clientVersion: string | undefined
  private readonly fetchFn: typeof fetch
  private readonly signInOffer: SignInOffer
  private readonly sessionsClientFor: SessionsClientFor | undefined
  private cached: { token: string; client: CloudClient } | undefined

  constructor(args: {
    sessions: CloudSessionStore
    localAccounts: AccountStorePort
    defaultUrl: string
    localSecrets?: FileSecretsStore
    localSettings?: SettingsStorePort
    clientVersion?: string
    fetchFn?: typeof fetch
    signInOffer?: SignInOffer
    sessionsClientFor?: SessionsClientFor
  }) {
    this.sessions = args.sessions
    this.localAccounts = args.localAccounts
    this.localSecrets = args.localSecrets
    this.localSettings = args.localSettings
    this.defaultUrl = args.defaultUrl
    this.clientVersion = args.clientVersion
    this.fetchFn = args.fetchFn ?? fetch
    this.signInOffer = args.signInOffer ?? fileSignInOffer()
    this.sessionsClientFor = args.sessionsClientFor
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
      this.sessionsClientFor?.({ session: args.session, clientVersion: this.clientVersion }) ??
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

    return { session }
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

  async uploadLocalToCloud(): Promise<CloudSyncCounts> {
    const client = this.requireClient()
    return {
      accounts: await uploadLocalAccounts({ client, local: this.localAccounts }),
      secrets: await uploadLocalSecrets({ client, localSecrets: this.localSecrets }),
      mcpServers: await uploadLocalMcp({ client }),
      settings: await uploadLocalSettings({ client, localSettings: this.localSettings }),
    }
  }

  async downloadCloudToLocal(): Promise<CloudSyncCounts> {
    const client = this.requireClient()
    return downloadCloudData({
      client,
      stores: {
        accounts: this.localAccounts,
        secrets: this.localSecrets,
        settings: this.localSettings,
      },
    })
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

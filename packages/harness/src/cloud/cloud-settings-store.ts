import type { ClockPort } from '@dltech/atlas-core'

import { CloudError, cloudClientFor, type CloudClient } from './cloud-client'
import type { CloudSession, CloudSessionStore } from './cloud-session'
import { isCloudUnavailable } from './cloud-transport'

export const CLOUD_SETTINGS_TTL_MS = 300_000

const REFUSED_STATUSES: readonly number[] = [401, 402, 403]

const SIGN_IN_MESSAGE = 'sign in to Atlas Cloud to change cloud settings'

type HeldSettings = {
  token: string
  values: Record<string, string>
  freshUntilMs: number
}

/**
 * A session-held TTL cache over the cloud settings resource: one bulk GET refreshes the whole
 * map, concurrent readers share the in-flight call, and mutations write through before the cache
 * is dropped. A refused token (401/402/403) drops the cache so the next read re-fetches; an
 * outage serves whatever is held, stale or not, because the cloud stays the source of truth.
 */
export class CloudSettingsStore {
  private readonly sessions: CloudSessionStore
  private readonly clock: ClockPort
  private readonly clientVersion: string | undefined
  private readonly fetchFn: typeof fetch | undefined
  private readonly listeners = new Set<() => void>()
  private held: HeldSettings | undefined
  private inFlight: Promise<void> | null = null
  private client: { token: string; client: CloudClient } | undefined
  private published = 0

  constructor(args: {
    sessions: CloudSessionStore
    clock: ClockPort
    clientVersion?: string
    fetchFn?: typeof fetch
  }) {
    this.sessions = args.sessions
    this.clock = args.clock
    this.clientVersion = args.clientVersion
    this.fetchFn = args.fetchFn
  }

  version(): number {
    return this.published
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  signedIn(): boolean {
    return this.sessions.read() !== null
  }

  invalidate(): void {
    this.held = undefined
  }

  values(): Record<string, string> {
    const session = this.sessions.read()
    if (session === null) {
      this.held = undefined
      return {}
    }

    const held = this.held
    if (held !== undefined && held.token === session.token && this.nowMs() < held.freshUntilMs) {
      return held.values
    }

    this.refreshInBackground()
    return held?.token === session.token ? held.values : {}
  }

  async refresh(): Promise<void> {
    const session = this.sessions.read()
    if (session === null) {
      this.held = undefined
      return
    }

    this.inFlight ??= this.load({ session }).finally(() => {
      this.inFlight = null
    })
    return this.inFlight
  }

  async set(args: { key: string; value: string }): Promise<void> {
    await this.clientFor({ session: this.requireSession() }).setSetting(args)
    this.invalidate()
    await this.refresh()
  }

  async remove(args: { key: string }): Promise<void> {
    await this.clientFor({ session: this.requireSession() }).deleteSetting(args)
    this.invalidate()
    await this.refresh()
  }

  private async load(args: { session: CloudSession }): Promise<void> {
    try {
      const settings = await this.clientFor({ session: args.session }).listSettings()
      this.held = {
        token: args.session.token,
        values: Object.fromEntries(settings.map((setting) => [setting.key, setting.value])),
        freshUntilMs: this.nowMs() + CLOUD_SETTINGS_TTL_MS,
      }
      this.publish()
    } catch (error) {
      if (error instanceof CloudError && REFUSED_STATUSES.includes(error.status)) {
        this.invalidate()
        throw error
      }
      if (isCloudUnavailable(error) && this.held !== undefined) return
      throw error
    }
  }

  private refreshInBackground(): void {
    void this.refresh().catch(() => undefined)
  }

  private requireSession(): CloudSession {
    const session = this.sessions.read()
    if (session === null) throw new CloudError({ status: 0, message: SIGN_IN_MESSAGE })
    return session
  }

  private clientFor(args: { session: CloudSession }): CloudClient {
    if (this.client?.token !== args.session.token) {
      this.client = {
        token: args.session.token,
        client: cloudClientFor({
          session: args.session,
          ...(this.clientVersion === undefined ? {} : { clientVersion: this.clientVersion }),
          ...(this.fetchFn === undefined ? {} : { fetchFn: this.fetchFn }),
        }),
      }
    }
    return this.client.client
  }

  private publish(): void {
    this.published += 1
    for (const listener of this.listeners) listener()
  }

  private nowMs(): number {
    return Date.parse(this.clock.now())
  }
}

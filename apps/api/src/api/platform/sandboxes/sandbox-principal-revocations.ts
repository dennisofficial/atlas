import type { SandboxPrincipalCache } from './sandbox-principal-cache'
import { notifyPrincipalRevoked, REVOKE_ALL } from './sandbox-principal-notify'
import { startPrincipalWatch, type PrincipalWatch } from './sandbox-principal-watch'

/**
 * Keeps one instance's principal cache honest: every revoking write evicts here at once and
 * notifies its siblings, and a listener carries in what the other instances wrote. Nothing starts
 * without a database URL, so a service a spec built on its own owns no connection.
 */
export class PrincipalRevocations {
  private watch: PrincipalWatch | undefined

  constructor(
    private readonly cache: SandboxPrincipalCache,
    private readonly log: (line: string, error?: unknown) => void,
  ) {}

  start(): void {
    if (this.watch !== undefined) return
    const url = process.env.DATABASE_URL
    if (url === undefined) return
    this.watch = startPrincipalWatch({
      url,
      onRevoked: (payload) => this.forget(payload),
      onConnected: () => this.cache.clear(),
      log: this.log,
    })
  }

  async close(): Promise<void> {
    await this.watch?.close()
    this.watch = undefined
  }

  /** Local eviction plus the notification that carries the same eviction to every other instance. */
  async revoke(sessionId: string): Promise<void> {
    this.cache.forgetSession(sessionId)
    await notifyPrincipalRevoked(sessionId)
  }

  async revokeAll(): Promise<void> {
    this.cache.clear()
    await notifyPrincipalRevoked(REVOKE_ALL)
  }

  private forget(payload: string): void {
    if (payload === REVOKE_ALL) this.cache.clear()
    else if (payload !== '') this.cache.forgetSession(payload)
  }
}

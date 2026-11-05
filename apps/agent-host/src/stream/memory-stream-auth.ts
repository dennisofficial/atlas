import { rawSessionToken } from './raw-session-token'
import type { StreamAuthPort, StreamPrincipal } from './stream-auth'

export class MemoryStreamAuth implements StreamAuthPort {
  private readonly principals = new Map<string, StreamPrincipal>()
  private readonly now: () => number
  failing = false
  hanging = false

  constructor(args: { now?: () => number } = {}) {
    this.now = args.now ?? Date.now
  }

  grant(args: { token: string; userId: string; expiresAt: number }): void {
    this.principals.set(args.token, { userId: args.userId, expiresAt: args.expiresAt })
  }

  revoke(args: { token: string }): void {
    this.principals.delete(args.token)
  }

  async resolve(bearer: string): Promise<StreamPrincipal | undefined> {
    if (this.hanging) return new Promise(() => undefined)
    if (this.failing) throw new Error('auth store unavailable')
    const token = rawSessionToken(bearer)
    if (token === undefined) return undefined
    const principal = this.principals.get(token)
    return principal !== undefined && principal.expiresAt > this.now() ? principal : undefined
  }
}

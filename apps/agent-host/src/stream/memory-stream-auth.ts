import { rawSessionToken } from './raw-session-token'
import type { StreamAuthPort, StreamPrincipal } from './stream-auth'

export class MemoryStreamAuth implements StreamAuthPort {
  private readonly principals = new Map<string, StreamPrincipal>()

  grant(args: { token: string; userId: string; expiresAt: number }): void {
    this.principals.set(args.token, { userId: args.userId, expiresAt: args.expiresAt })
  }

  revoke(args: { token: string }): void {
    this.principals.delete(args.token)
  }

  async resolve(bearer: string): Promise<StreamPrincipal | undefined> {
    const token = rawSessionToken(bearer)
    if (token === undefined) return undefined
    const principal = this.principals.get(token)
    return principal !== undefined && principal.expiresAt > Date.now() ? principal : undefined
  }
}

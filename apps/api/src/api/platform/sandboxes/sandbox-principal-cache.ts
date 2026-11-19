import type { SandboxPrincipal } from './rows'

export const PRINCIPAL_CACHE_TTL_MS = 30_000
export const PRINCIPAL_CACHE_LIMIT = 10_000

type CachedPrincipal = {
  principal: SandboxPrincipal
  sessionId: string
  expiresAt: number
}

export type PrincipalLookup = {
  startedAt: number
  generation: number
}

export class SandboxPrincipalCache {
  private readonly entries = new Map<string, CachedPrincipal>()
  private generation = 0

  beginLookup(): PrincipalLookup {
    return { startedAt: Date.now(), generation: this.generation }
  }

  get(tokenHash: string): SandboxPrincipal | null {
    const entry = this.entries.get(tokenHash)
    if (entry === undefined) return null
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(tokenHash)
      return null
    }
    this.entries.delete(tokenHash)
    this.entries.set(tokenHash, entry)
    return entry.principal
  }

  remember(args: {
    tokenHash: string
    principal: SandboxPrincipal
    sessionId: string
    lookup: PrincipalLookup
  }): void {
    if (args.lookup.generation !== this.generation) return
    this.entries.delete(args.tokenHash)
    this.entries.set(args.tokenHash, {
      principal: args.principal,
      sessionId: args.sessionId,
      expiresAt: args.lookup.startedAt + PRINCIPAL_CACHE_TTL_MS,
    })
    while (this.entries.size > PRINCIPAL_CACHE_LIMIT) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) return
      this.entries.delete(oldest)
    }
  }

  forgetSession(sessionId: string): void {
    this.generation += 1
    for (const [tokenHash, entry] of this.entries) {
      if (entry.sessionId === sessionId) this.entries.delete(tokenHash)
    }
  }

  clear(): void {
    this.generation += 1
    this.entries.clear()
  }
}

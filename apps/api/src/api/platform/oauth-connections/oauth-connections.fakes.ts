import { EConnectionStatus, OauthClock, OauthConnectionStore, OauthIssuer } from './oauth-connections.types'
import type { AttemptFence, ConnectionRow, ProviderTokens } from './oauth-connections.types'

export class FakeStore implements OauthConnectionStore {
  readonly rows = new Map<string, ConnectionRow>()
  readonly sandboxes = new Map<string, { id: string; userId: string }>()
  readonly assignments = new Set<string>()

  async insert(row: { id: string; userId: string; provider: string; sealedTokens: string }) {
    if (this.rows.has(row.id)) return false
    this.rows.set(row.id, {
      ...row,
      authorizationId: row.id,
      status: EConnectionStatus.Active,
      generation: 0,
      refreshAttempt: null,
      refreshStartedAt: null,
    })
    return true
  }

  async find(args: { id: string }) {
    const row = this.rows.get(args.id)
    return row === undefined ? null : { ...row }
  }

  async reauthorize(args: {
    id: string
    userId: string
    authorizationId: string
    previousAuthorizationId: string
    sealedTokens: string
  }) {
    const row = this.rows.get(args.id)
    if (row?.userId !== args.userId || row.authorizationId !== args.previousAuthorizationId) return false
    Object.assign(row, {
      sealedTokens: args.sealedTokens,
      authorizationId: args.authorizationId,
      status: EConnectionStatus.Active,
      generation: row.generation + 1,
      refreshAttempt: null,
      refreshStartedAt: null,
    })
    return true
  }

  async claim(args: { id: string; userId: string; generation: number; attemptId: string; startedAt: Date }) {
    const row = this.rows.get(args.id)
    if (
      row === undefined || row.userId !== args.userId || row.generation !== args.generation ||
      row.refreshAttempt !== null || row.status !== EConnectionStatus.Active
    ) return false
    row.refreshAttempt = args.attemptId
    row.refreshStartedAt = args.startedAt
    return true
  }

  private fenced(fence: AttemptFence): ConnectionRow | undefined {
    const row = this.rows.get(fence.id)
    const holds = row?.generation === fence.generation && row.refreshAttempt === fence.attemptId
    return holds ? row : undefined
  }

  async complete(args: AttemptFence & { sealedTokens: string }) {
    const row = this.fenced(args)
    if (row === undefined) return false
    Object.assign(row, {
      sealedTokens: args.sealedTokens,
      generation: row.generation + 1,
      refreshAttempt: null,
      refreshStartedAt: null,
    })
    return true
  }

  async release(args: AttemptFence) {
    const row = this.fenced(args)
    if (row === undefined) return false
    Object.assign(row, { refreshAttempt: null, refreshStartedAt: null })
    return true
  }

  async reject(args: AttemptFence) {
    const row = this.fenced(args)
    if (row === undefined) return false
    Object.assign(row, { status: EConnectionStatus.Expired, refreshAttempt: null, refreshStartedAt: null })
    return true
  }

  async ownedSandboxId(args: { userId: string; threadId: string }) {
    const sandbox = this.sandboxes.get(args.threadId)
    return sandbox?.userId === args.userId ? sandbox.id : null
  }

  async assign(args: { connectionId: string; sandboxId: string }) {
    this.assignments.add(`${args.connectionId}:${args.sandboxId}`)
  }

  async isAssigned(args: { connectionId: string; sandboxId: string }) {
    return this.assignments.has(`${args.connectionId}:${args.sandboxId}`)
  }

  async remove(args: { id: string; userId: string }) {
    if (this.rows.get(args.id)?.userId !== args.userId) return false
    this.rows.delete(args.id)
    return true
  }
}

export class FakeClock implements OauthClock {
  sleeps = 0
  onSleep: () => void = () => undefined

  constructor(public current: number) {}

  now(): number {
    return this.current
  }

  async sleep(ms: number): Promise<void> {
    this.current += ms
    this.sleeps += 1
    this.onSleep()
    await new Promise((resolve) => setImmediate(resolve))
  }
}

type Issued = Awaited<ReturnType<OauthIssuer['refresh']>>

export class FakeIssuer implements OauthIssuer {
  readonly calls: string[] = []
  outcome: (args: { refreshToken: string; nowMs: number; call: number }) => Promise<Issued> =
    async (args) => ({
      accessToken: `access-${this.calls.length}`,
      refreshToken: `refresh-${this.calls.length}`,
      expiresAt: new Date(args.nowMs + 3_600_000).toISOString(),
    })

  async refresh(args: { refreshToken: string; nowMs: number }): Promise<Issued> {
    this.calls.push(args.refreshToken)
    return this.outcome({ ...args, call: this.calls.length })
  }
}

export const grantOf = (nowMs: number, lifetimeMs = 3_600_000): ProviderTokens => ({
  accessToken: 'access-0',
  refreshToken: 'refresh-0',
  expiresAt: new Date(nowMs + lifetimeMs).toISOString(),
})

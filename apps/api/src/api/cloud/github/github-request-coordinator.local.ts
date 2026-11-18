import {
  GITHUB_HTTP_BUDGET_PER_MINUTE,
  githubHttpBudgetOf,
  type RepoAccessProof,
  type CoordinatorAdapter,
  type RefreshAttempt,
  type GithubRequestIdentity,
} from './github-request-coordinator.types'

type HttpWindow = { minute: number; spent: number; categories: Map<string, number> }

export class LocalCoordinatorAdapter implements CoordinatorAdapter {
  private readonly authorizations = new Map<string, RepoAccessProof>()
  private readonly versions = new Map<string, { value: number; expiresAt: number }>()
  private readonly windows = new Map<string, HttpWindow>()
  private readonly attempts = new Map<string, RefreshAttempt & { expiresAt: number }>()
  private readonly blockedUntil = new Map<string, number>()
  private readonly reservedUntil = new Map<string, number>()

  private authorizationState(key: string): RepoAccessProof | undefined {
    const state = this.authorizations.get(key)
    if (state === undefined) return undefined
    if (!state.granted && state.deniedUntil <= Date.now()) {
      this.authorizations.delete(key)
      return undefined
    }
    return state
  }

  async readAuthorization(key: string): Promise<RepoAccessProof | undefined> {
    const state = this.authorizationState(key)
    return state === undefined ? undefined : { ...state }
  }

  async beginAuthorization(key: string): Promise<number> {
    for (const [held, version] of this.versions)
      if (version.expiresAt <= Date.now()) this.versions.delete(held)
    const value = (this.versions.get(key)?.value ?? 0) + 1
    this.versions.set(key, { value, expiresAt: Date.now() + 1_200_000 })
    return value
  }

  async writeAuthorization(args: {
    key: string
    state: RepoAccessProof
  }): Promise<RepoAccessProof> {
    const held = this.authorizationState(args.key)
    const current = this.versions.get(args.key)?.value ?? 0
    if (
      held !== undefined &&
      (held.version > args.state.version ||
        (held.version === args.state.version &&
          held.deniedUntil > Date.now() &&
          args.state.granted))
    )
      return { ...held }
    if (args.state.granted && current > args.state.version)
      return held === undefined
        ? {
            version: current,
            checkedAt: Date.now(),
            granted: false,
            deniedUntil: 0,
            message: 'Authorization superseded; retrying',
          }
        : { ...held }
    this.authorizations.set(args.key, { ...args.state })
    return { ...args.state }
  }

  async revokeAuthorization(key: string): Promise<void> {
    this.authorizations.delete(key)
  }

  async revokeAuthorizations(prefix: string): Promise<void> {
    for (const key of [...this.authorizations.keys()])
      if (key.startsWith(prefix)) this.authorizations.delete(key)
  }

  async takeHttpSlot(identity?: GithubRequestIdentity): Promise<boolean> {
    if (Date.now() < (this.blockedUntil.get(this.cooldownKey(identity)) ?? 0)) return false
    const window = this.windowOf(this.credentialOf(identity))
    if (window.spent >= GITHUB_HTTP_BUDGET_PER_MINUTE) return false
    const category = identity?.category ?? 'unclassified'
    const spent = window.categories.get(category) ?? 0
    if (spent >= githubHttpBudgetOf(identity?.category)) return false
    window.categories.set(category, spent + 1)
    window.spent += 1
    return true
  }

  private windowOf(credential: string): HttpWindow {
    const minute = Math.floor(Date.now() / 60_000)
    for (const [held, window] of this.windows)
      if (window.minute !== minute) this.windows.delete(held)
    const held = this.windows.get(credential)
    if (held !== undefined && held.minute === minute) return held
    const window: HttpWindow = { minute, spent: 0, categories: new Map() }
    this.windows.set(credential, window)
    return window
  }

  async httpReserveUntil(identity: GithubRequestIdentity): Promise<number> {
    return this.reservedUntil.get(this.reserveKey(identity)) ?? 0
  }

  async holdHttpReserve(args: { until: number } & Partial<GithubRequestIdentity>): Promise<void> {
    for (const [key, until] of this.reservedUntil)
      if (until <= Date.now()) this.reservedUntil.delete(key)
    const key = this.reserveKey(args)
    this.reservedUntil.set(key, Math.max(this.reservedUntil.get(key) ?? 0, args.until))
  }

  async httpCooldownUntil(identity: GithubRequestIdentity): Promise<number> {
    return this.blockedUntil.get(this.cooldownKey(identity)) ?? 0
  }

  async blockHttpUntil(args: { until: number } & Partial<GithubRequestIdentity>): Promise<void> {
    for (const [key, until] of this.blockedUntil)
      if (until <= Date.now()) this.blockedUntil.delete(key)
    const key = this.cooldownKey(args)
    this.blockedUntil.set(key, Math.max(this.blockedUntil.get(key) ?? 0, args.until))
  }

  private credentialOf(identity?: Partial<GithubRequestIdentity>): string {
    return identity?.credentialFingerprint ?? 'unattributed'
  }

  private cooldownKey(identity?: Partial<GithubRequestIdentity>): string {
    return `${this.credentialOf(identity)}:${identity?.resource ?? 'core'}`
  }

  private reserveKey(identity?: Partial<GithubRequestIdentity>): string {
    return `${this.credentialOf(identity)}:${identity?.resource ?? 'core'}`
  }

  async attempt(key: string): Promise<RefreshAttempt> {
    const held = this.attempts.get(key)
    if (held === undefined || held.expiresAt <= Date.now()) {
      this.attempts.delete(key)
      return { nextAttemptAt: 0, failures: 0 }
    }
    return { nextAttemptAt: held.nextAttemptAt, failures: held.failures }
  }

  async recordAttempt(args: { key: string; failed: boolean }): Promise<void> {
    const prior = await this.attempt(args.key)
    const failures = args.failed ? Math.min(prior.failures + 1, 8) : 0
    for (const [key, attempt] of this.attempts)
      if (attempt.expiresAt <= Date.now()) this.attempts.delete(key)
    this.attempts.set(args.key, {
      failures,
      expiresAt: Date.now() + 1_200_000,
      nextAttemptAt:
        Date.now() + (args.failed ? Math.min(30_000 * 2 ** failures, 600_000) : 30_000),
    })
  }
}

export const localCoordinatorAdapter = new LocalCoordinatorAdapter()

import {
  GITHUB_HTTP_BUDGET_PER_MINUTE,
  GITHUB_AUTH_HTTP_BUDGET_PER_MINUTE,
  GITHUB_REFRESH_HTTP_BUDGET_PER_MINUTE,
  EGithubHttpCategory,
  type RepoAccessProof,
  type CoordinatorAdapter,
  type RefreshAttempt,
  type GithubRequestIdentity,
} from './github-request-coordinator.types'

export class LocalCoordinatorAdapter implements CoordinatorAdapter {
  private readonly authorizations = new Map<string, RepoAccessProof>()
  private readonly versions = new Map<string, { value: number; expiresAt: number }>()
  private readonly categorySpent = new Map<string, number>()
  private readonly sourceSpent = new Map<string, number>()
  private readonly attempts = new Map<string, RefreshAttempt & { expiresAt: number }>()
  private minute = 0
  private spent = 0
  private readonly blockedUntil = new Map<string, number>()

  private authorizationState(key: string): RepoAccessProof | undefined {
    const state = this.authorizations.get(key)
    if (state === undefined) return undefined
    if (Math.max(state.authorizedUntil, state.deniedUntil) <= Date.now()) {
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
          args.state.authorizedUntil > 0))
    )
      return { ...held }
    if (args.state.authorizedUntil > 0 && current > args.state.version)
      return held === undefined
        ? {
            version: current,
            checkedAt: Date.now(),
            authorizedUntil: 0,
            deniedUntil: 0,
            message: 'Authorization superseded; retrying',
          }
        : { ...held }
    for (const key of this.authorizations.keys()) this.authorizationState(key)
    this.authorizations.set(args.key, { ...args.state })
    return { ...args.state }
  }

  async takeHttpSlot(identity?: GithubRequestIdentity): Promise<boolean> {
    if (Date.now() < (this.blockedUntil.get(this.cooldownKey(identity)) ?? 0)) return false
    const minute = Math.floor(Date.now() / 60_000)
    if (minute !== this.minute) {
      this.minute = minute
      this.spent = 0
      this.categorySpent.clear()
      this.sourceSpent.clear()
    }
    if (this.spent >= GITHUB_HTTP_BUDGET_PER_MINUTE) return false
    const category = identity?.category ?? 'unclassified'
    const limit =
      category === EGithubHttpCategory.Authorization
        ? GITHUB_AUTH_HTTP_BUDGET_PER_MINUTE
        : category === EGithubHttpCategory.Refresh
          ? GITHUB_REFRESH_HTTP_BUDGET_PER_MINUTE
          : GITHUB_HTTP_BUDGET_PER_MINUTE
    const spent = this.categorySpent.get(category) ?? 0
    if (spent >= limit) return false
    this.categorySpent.set(category, spent + 1)
    const source = identity?.source ?? 'unattributed'
    this.sourceSpent.set(source, (this.sourceSpent.get(source) ?? 0) + 1)
    this.spent += 1
    return true
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

  private cooldownKey(identity?: Partial<GithubRequestIdentity>): string {
    return `${identity?.credentialFingerprint ?? 'unattributed'}:${identity?.resource ?? 'core'}`
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

import { prIdentity } from './github-linked-prs'
import {
  GITHUB_HTTP_BUDGET_PER_MINUTE,
  GITHUB_AUTH_HTTP_BUDGET_PER_MINUTE,
  GITHUB_REFRESH_HTTP_BUDGET_PER_MINUTE,
  EGithubHttpCategory,
  type ObservationAuthorization,
  type ObservationAdapter,
  type ObservationAttempt,
  type ObservationLease,
  type GithubRequestIdentity,
} from './github-observation.types'

export class LocalObservationAdapter implements ObservationAdapter {
  private readonly leases = new Map<string, ObservationLease>()
  private readonly authorizations = new Map<string, ObservationAuthorization>()
  private readonly versions = new Map<string, { value: number; expiresAt: number }>()
  private readonly categorySpent = new Map<string, number>()
  private readonly index = new Map<string, Set<string>>()
  private readonly attempts = new Map<string, ObservationAttempt & { expiresAt: number }>()
  private minute = 0
  private spent = 0
  private readonly blockedUntil = new Map<string, number>()
  private cursor = 0

  private authorizationState(key: string): ObservationAuthorization | undefined {
    const state = this.authorizations.get(key)
    if (state === undefined) return undefined
    if (Math.max(state.authorizedUntil, state.deniedUntil) <= Date.now()) {
      this.authorizations.delete(key)
      return undefined
    }
    return state
  }

  async readAuthorization(key: string): Promise<ObservationAuthorization | undefined> {
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
    state: ObservationAuthorization
  }): Promise<ObservationAuthorization> {
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

  async read(id: string): Promise<ObservationLease | undefined> {
    const held = this.leases.get(id)
    if (held === undefined) return undefined
    if (held.expiresAt > Date.now()) return held
    await this.remove(id)
    return undefined
  }

  async write(lease: ObservationLease): Promise<void> {
    await this.remove(lease.id)
    for (const held of [...this.leases.values()]) {
      if (held.expiresAt <= Date.now()) await this.remove(held.id)
    }
    this.leases.set(lease.id, lease)
    for (const key of lease.keys) {
      for (const identity of [key.repoFullName, prIdentity(key)]) {
        const ids = this.index.get(identity) ?? new Set<string>()
        ids.add(lease.id)
        this.index.set(identity, ids)
      }
    }
  }

  async remove(id: string): Promise<void> {
    const lease = this.leases.get(id)
    if (lease === undefined) return
    this.leases.delete(id)
    for (const key of lease.keys) {
      for (const identity of [key.repoFullName, prIdentity(key)]) {
        const ids = this.index.get(identity)
        ids?.delete(id)
        if (ids?.size === 0) this.index.delete(identity)
      }
    }
  }

  async entries(filter?: { repoFullName: string; prNumber?: number }): Promise<ObservationLease[]> {
    const ids =
      filter === undefined
        ? [...this.leases.keys()]
        : [
            ...(this.index.get(
              filter.prNumber === undefined
                ? filter.repoFullName
                : prIdentity({ ...filter, prNumber: filter.prNumber }),
            ) ?? []),
          ]
    const offset = filter === undefined ? this.cursor % Math.max(ids.length, 1) : 0
    const selected =
      filter === undefined ? [...ids.slice(offset), ...ids.slice(0, offset)].slice(0, 128) : ids
    if (filter === undefined) this.cursor += selected.length
    const leases = await Promise.all(selected.map((id) => this.read(id)))
    return leases.filter((lease): lease is ObservationLease => lease !== undefined)
  }

  async takeHttpSlot(identity?: GithubRequestIdentity): Promise<boolean> {
    if (Date.now() < (this.blockedUntil.get(this.cooldownKey(identity)) ?? 0)) return false
    const minute = Math.floor(Date.now() / 60_000)
    if (minute !== this.minute) {
      this.minute = minute
      this.spent = 0
      this.categorySpent.clear()
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

  async attempt(key: string): Promise<ObservationAttempt> {
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

export const localObservationAdapter = new LocalObservationAdapter()

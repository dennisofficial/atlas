import { Inject, Injectable, Optional } from '@nestjs/common'
import { RedisService } from '../../../_lib/redis/redis.service'
import { normalizedRepo, prIdentity } from './github-linked-prs'
import { LocalObservationAdapter, localObservationAdapter } from './github-observation.local'
import { RedisObservationAdapter } from './github-observation.redis'
import { GithubObservationAcquirer } from './github-observation-acquire'
import { authorizationAllows, authorizationKey } from './github-observation-authorization'
import type {
  ObservationAdapter,
  ObservationLease,
  ObservedPr,
  GithubRequestIdentity,
  GithubObservationAcquire,
  ObservationAcquisition,
} from './github-observation.types'
import { credentialFingerprint } from './github-request-budget'
export { credentialFingerprint } from './github-request-budget'
import { GithubService } from './github.service'

export const GITHUB_OBSERVATION_PREFIX = Symbol('GITHUB_OBSERVATION_PREFIX')

@Injectable()
export class GithubObservationStore {
  private readonly adapter: ObservationAdapter
  private readonly acquisition: GithubObservationAcquirer
  constructor(
    redis: RedisService,
    private readonly github: GithubService,
    @Optional() @Inject(GITHUB_OBSERVATION_PREFIX) prefix?: string,
  ) {
    this.adapter = redis.isConfigured()
      ? new RedisObservationAdapter(redis.client(), prefix)
      : prefix === undefined
        ? localObservationAdapter
        : new LocalObservationAdapter()
    this.acquisition = new GithubObservationAcquirer({
      adapter: this.adapter,
      github,
      budget: this,
      coordinated: (work) => this.coordinated(work),
    })
  }

  acquire(args: GithubObservationAcquire): Promise<ObservationAcquisition> {
    return this.acquisition.acquire(args)
  }
  release(id: string): Promise<void> {
    return this.coordinated(this.adapter.remove(id))
  }

  async owners(args: { repoFullName: string; prNumber: number }): Promise<string[]> {
    return this.authorizedOwners(
      await this.coordinated(
        this.adapter.entries({ ...args, repoFullName: normalizedRepo(args.repoFullName) }),
      ),
      normalizedRepo(args.repoFullName),
    )
  }

  async repoOwners(args: { repoFullName: string }): Promise<string[]> {
    const repo = normalizedRepo(args.repoFullName)
    return this.authorizedOwners(
      await this.coordinated(this.adapter.entries({ repoFullName: repo })),
      repo,
    )
  }

  async hasRepo(args: { repoFullName: string }): Promise<boolean> {
    return (await this.repoOwners(args)).length > 0
  }

  async targets(): Promise<Array<ObservedPr & { userIds: string[] }>> {
    const leases = await this.coordinated(this.adapter.entries())
    const targets = new Map<string, ObservedPr & { userIds: string[] }>()
    const fingerprints = new Map<string, string | undefined>()
    const permissions = new Map<string, Promise<boolean>>()
    for (const lease of leases) {
      if (!fingerprints.has(lease.userId))
        fingerprints.set(lease.userId, await this.currentFingerprint(lease.userId))
      const fingerprint = fingerprints.get(lease.userId)
      if (
        fingerprint === undefined ||
        fingerprint !== lease.credentialFingerprint ||
        lease.expiresAt <= Date.now()
      )
        continue
      for (const key of lease.keys) {
        if ((lease.authorizedUntil[key.repoFullName] ?? 0) <= Date.now()) continue
        const aclKey = authorizationKey({
          userId: lease.userId,
          fingerprint,
          repo: key.repoFullName,
        })
        if (!permissions.has(aclKey))
          permissions.set(
            aclKey,
            this.allows({ userId: lease.userId, fingerprint, repo: key.repoFullName }),
          )
        if (!(await permissions.get(aclKey))) continue
        const identity = prIdentity(key)
        const target = targets.get(identity) ?? { ...key, userIds: [] }
        if (!target.userIds.includes(lease.userId)) target.userIds.push(lease.userId)
        targets.set(identity, target)
      }
    }
    return [...targets.values()]
  }

  takeHttpSlot(identity?: GithubRequestIdentity): Promise<boolean> {
    return this.coordinated(this.adapter.takeHttpSlot(identity))
  }
  httpCooldownUntil(identity: GithubRequestIdentity): Promise<number> {
    return this.coordinated(this.adapter.httpCooldownUntil(identity))
  }
  blockHttpUntil(args: { until: number } & Partial<GithubRequestIdentity>): Promise<void> {
    return this.coordinated(this.adapter.blockHttpUntil(args))
  }
  attempt(args: { key: string }) {
    return this.coordinated(this.adapter.attempt(args.key))
  }
  recordAttempt(args: { key: string; failed: boolean }): Promise<void> {
    return this.coordinated(this.adapter.recordAttempt(args))
  }

  private async authorizedOwners(leases: ObservationLease[], repo: string): Promise<string[]> {
    const fingerprints = new Map<string, Set<string>>()
    for (const lease of leases) {
      if (lease.expiresAt <= Date.now() || (lease.authorizedUntil[repo] ?? 0) <= Date.now())
        continue
      const held = fingerprints.get(lease.userId) ?? new Set<string>()
      held.add(lease.credentialFingerprint)
      fingerprints.set(lease.userId, held)
    }
    const owners: string[] = []
    for (const [userId, proofs] of fingerprints) {
      const current = await this.currentFingerprint(userId)
      if (
        current !== undefined &&
        proofs.has(current) &&
        (await this.allows({ userId, fingerprint: current, repo }))
      )
        owners.push(userId)
    }
    return owners
  }

  private async allows(args: {
    userId: string
    fingerprint: string
    repo: string
  }): Promise<boolean> {
    return authorizationAllows(
      await this.coordinated(this.adapter.readAuthorization(authorizationKey(args))),
    )
  }

  private async currentFingerprint(userId: string): Promise<string | undefined> {
    const token = await this.github.findToken({ userId })
    return token === undefined ? undefined : credentialFingerprint(token)
  }

  private async coordinated<T>(work: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        work,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('PR observation coordinator timed out')), 2_000)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }
}

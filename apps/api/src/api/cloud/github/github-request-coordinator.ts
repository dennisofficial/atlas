import { Inject, Injectable, Optional } from '@nestjs/common'
import { RedisService } from '../../../_lib/redis/redis.service'
import { normalizedRepo } from './github-linked-prs'
import {
  LocalCoordinatorAdapter,
  localCoordinatorAdapter,
} from './github-request-coordinator.local'
import { RedisCoordinatorAdapter } from './github-request-coordinator.redis'
import { accessProofAllows, accessProofKey } from './github-repo-access-proof'
import {
  ACCESS_PROOF_DENIAL_TTL_MS,
  ACCESS_PROOF_TTL_MS,
  type CoordinatorAdapter,
  type GithubRequestIdentity,
} from './github-request-coordinator.types'
import { credentialFingerprint } from './github-request-budget'
import { GithubService } from './github.service'

export const GITHUB_COORDINATOR_PREFIX = Symbol('GITHUB_COORDINATOR_PREFIX')

@Injectable()
export class GithubRequestCoordinator {
  private readonly adapter: CoordinatorAdapter
  constructor(
    redis: RedisService,
    private readonly github: GithubService,
    @Optional() @Inject(GITHUB_COORDINATOR_PREFIX) prefix?: string,
  ) {
    this.adapter = redis.isConfigured()
      ? new RedisCoordinatorAdapter(redis.client(), prefix)
      : prefix === undefined
        ? localCoordinatorAdapter
        : new LocalCoordinatorAdapter()
  }

  takeHttpSlot(identity?: GithubRequestIdentity): Promise<boolean> {
    return this.coordinated(this.adapter.takeHttpSlot(identity))
  }
  httpCooldownUntil(identity: GithubRequestIdentity): Promise<number> {
    return this.coordinated(this.adapter.httpCooldownUntil(identity))
  }
  httpReserveUntil(identity: GithubRequestIdentity): Promise<number> {
    return this.coordinated(this.adapter.httpReserveUntil(identity))
  }
  blockHttpUntil(args: { until: number } & Partial<GithubRequestIdentity>): Promise<void> {
    return this.coordinated(this.adapter.blockHttpUntil(args))
  }
  holdHttpReserve(args: { until: number } & Partial<GithubRequestIdentity>): Promise<void> {
    return this.coordinated(this.adapter.holdHttpReserve(args))
  }
  attempt(args: { key: string }) {
    return this.coordinated(this.adapter.attempt(args.key))
  }
  recordAttempt(args: { key: string; failed: boolean }): Promise<void> {
    return this.coordinated(this.adapter.recordAttempt(args))
  }

  /**
   * A proven repository authorization is shared with every reader of the same credential, so a
   * subscribe that would otherwise spend a `/repos/{owner}/{repo}` call rides the proof an earlier
   * access check already wrote.
   */
  async provenAccess(args: { userId: string; repoFullName: string }): Promise<boolean> {
    const key = await this.proofKey(args)
    if (key === undefined) return false
    try {
      const state = await this.coordinated(this.adapter.readAuthorization(key))
      return accessProofAllows(state)
    } catch {
      return false
    }
  }

  async deniedAccess(args: { userId: string; repoFullName: string }): Promise<boolean> {
    const key = await this.proofKey(args)
    if (key === undefined) return false
    try {
      const state = await this.coordinated(this.adapter.readAuthorization(key))
      return state !== undefined && state.deniedUntil > Date.now()
    } catch {
      return false
    }
  }

  recordAccess(args: { userId: string; repoFullName: string }): Promise<void> {
    return this.recordProof({ ...args, granted: true })
  }

  recordDenial(args: { userId: string; repoFullName: string; message: string }): Promise<void> {
    return this.recordProof({ ...args, granted: false })
  }

  private async recordProof(args: {
    userId: string
    repoFullName: string
    granted: boolean
    message?: string
  }): Promise<void> {
    const key = await this.proofKey(args)
    if (key === undefined) return
    const until = Date.now() + (args.granted ? ACCESS_PROOF_TTL_MS : ACCESS_PROOF_DENIAL_TTL_MS)
    try {
      const version = await this.coordinated(this.adapter.beginAuthorization(key))
      await this.coordinated(
        this.adapter.writeAuthorization({
          key,
          state: {
            version,
            checkedAt: Date.now(),
            authorizedUntil: args.granted ? until : 0,
            deniedUntil: args.granted ? 0 : until,
            ...(args.message === undefined ? {} : { message: args.message }),
          },
        }),
      )
    } catch {
      return
    }
  }

  private async proofKey(args: {
    userId: string
    repoFullName: string
  }): Promise<string | undefined> {
    const token = await this.github.findToken({ userId: args.userId })
    if (token === undefined) return undefined
    return accessProofKey({
      userId: args.userId,
      fingerprint: credentialFingerprint(token),
      repo: normalizedRepo(args.repoFullName),
    })
  }

  private async coordinated<T>(work: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        work,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('GitHub request coordinator timed out')), 2_000)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }
}

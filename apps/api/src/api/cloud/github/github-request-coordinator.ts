import { normalizedRepo } from './github-linked-prs'
import type { GithubRedis } from './github-ports'
import {
  LocalCoordinatorAdapter,
  localCoordinatorAdapter,
} from './github-request-coordinator.local'
import { RedisCoordinatorAdapter } from './github-request-coordinator.redis'
import { accessProofAllows, accessProofKey, accessProofPrefix } from './github-repo-access-proof'
import {
  ACCESS_PROOF_DENIAL_TTL_MS,
  type CoordinatorAdapter,
  type GithubRequestIdentity,
} from './github-request-coordinator.types'
import { credentialFingerprint } from './github-request-budget'
import { GithubService } from './github.service'

export const GITHUB_COORDINATOR_PREFIX = Symbol('GITHUB_COORDINATOR_PREFIX')

export class GithubRequestCoordinator {
  private readonly adapter: CoordinatorAdapter
  constructor(
    redis: GithubRedis,
    private readonly github: GithubService,
    prefix?: string,
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

  /**
   * A proven repository authorization is shared with every reader of the same credential, so a
   * subscribe that would otherwise spend a `/repos/{owner}/{repo}` call rides the proof an earlier
   * read already wrote.
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

  revokeAccessGrant(args: {
    credentialFingerprint: string
    repoFullName?: string | undefined
  }): Promise<void> {
    if (args.repoFullName === undefined)
      return this.revoke(
        this.adapter.revokeAuthorizations(accessProofPrefix(args.credentialFingerprint)),
      )
    return this.revoke(
      this.adapter.revokeAuthorization(
        accessProofKey({
          credentialFingerprint: args.credentialFingerprint,
          repo: normalizedRepo(args.repoFullName),
        }),
      ),
    )
  }

  private async revoke(work: Promise<void>): Promise<void> {
    try {
      await this.coordinated(work)
    } catch {
      return
    }
  }

  private async recordProof(args: {
    userId: string
    repoFullName: string
    granted: boolean
    message?: string
  }): Promise<void> {
    const key = await this.proofKey(args)
    if (key === undefined) return
    try {
      const version = await this.coordinated(this.adapter.beginAuthorization(key))
      await this.coordinated(
        this.adapter.writeAuthorization({
          key,
          state: {
            version,
            checkedAt: Date.now(),
            granted: args.granted,
            deniedUntil: args.granted ? 0 : Date.now() + ACCESS_PROOF_DENIAL_TTL_MS,
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
      credentialFingerprint: credentialFingerprint(token),
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

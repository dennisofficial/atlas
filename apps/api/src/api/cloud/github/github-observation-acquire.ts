import { ForbiddenException } from '@nestjs/common'
import { linkedPrs, normalizedRepo, prIdentity } from './github-linked-prs'
import {
  GithubAuthorizationWork,
  AUTHORIZATION_CHECKS_PER_ACQUIRE,
  authorizationKey,
  authorizationAllows,
} from './github-observation-authorization'
import {
  OBSERVATION_TTL_MS,
  type ObservationAdapter,
  type GithubObservationAcquire,
  type ObservationAcquisition,
  type ObservationAuthorization,
} from './github-observation.types'
import { RepoAccessChecker } from './github-repo-access'
import { EGithubCallSource } from './github-call-log'
import {
  withGithubRequestBudget,
  credentialFingerprint,
  type GithubHttpBudget,
} from './github-request-budget'
import type { GithubService } from './github.service'

type Dependencies = {
  adapter: ObservationAdapter
  github: GithubService
  budget: GithubHttpBudget
  coordinated: <T>(work: Promise<T>) => Promise<T>
}
type RepoResult = {
  until: number
  attempted: boolean
  message?: string
  changed?: boolean
  unavailable?: boolean
}

export class GithubObservationAcquirer {
  private readonly scheduling = new GithubAuthorizationWork()
  constructor(private readonly deps: Dependencies) {}

  async acquire(args: GithubObservationAcquire): Promise<ObservationAcquisition> {
    try {
      return await this.acquireCurrent(args)
    } catch (failure) {
      if (args.signal?.aborted === true) await this.release(args.id).catch(() => undefined)
      throw failure
    }
  }

  private async acquireCurrent(args: GithubObservationAcquire): Promise<ObservationAcquisition> {
    args.signal?.throwIfAborted()
    if (args.observe.length === 0) {
      await this.release(args.id)
      return { keys: [], available: true }
    }
    const token = await this.deps.github.findToken({ userId: args.userId })
    if (token === undefined) return this.changed(args.id)
    const fingerprint = credentialFingerprint(token)
    const owned = new Set((await linkedPrs({ userId: args.userId })).map(prIdentity))
    const requested = new Map(
      args.observe.slice(0, 128).map((pr) => {
        const key = { repoFullName: normalizedRepo(pr.repo), prNumber: pr.number }
        return [prIdentity(key), key] as const
      }),
    )
    const candidates = [...requested].filter(([key]) => owned.has(key)).map(([, key]) => key)
    const repos = [...new Set(candidates.map((key) => key.repoFullName))]
    const cursor = `${args.userId}:${fingerprint}`
    const authorizedUntil: Record<string, number> = {}
    let message: string | undefined
    let checks = 0
    for (const repo of this.scheduling.ordered({ key: cursor, repos })) {
      args.signal?.throwIfAborted()
      if (!(await this.current({ userId: args.userId, fingerprint }))) return this.changed(args.id)
      const result = await this.authorizeRepo({
        ...args,
        repo,
        token,
        fingerprint,
        allowRequest: checks < AUTHORIZATION_CHECKS_PER_ACQUIRE,
      })
      if (result.changed) return this.changed(args.id)
      if (result.attempted) {
        checks += 1
        this.scheduling.advance({ key: cursor, repo, repos })
      }
      if (result.message !== undefined) message = result.message
      if (result.until > Date.now()) authorizedUntil[repo] = result.until
      if (result.unavailable) break
    }
    const keys = candidates.filter((key) => (authorizedUntil[key.repoFullName] ?? 0) > Date.now())
    args.signal?.throwIfAborted()
    if (!(await this.current({ userId: args.userId, fingerprint }))) return this.changed(args.id)
    args.signal?.throwIfAborted()
    await this.deps
      .coordinated(
        keys.length === 0
          ? this.deps.adapter.remove(args.id)
          : this.deps.adapter.write({
              id: args.id,
              userId: args.userId,
              keys,
              credentialFingerprint: fingerprint,
              authorizedUntil,
              expiresAt: Date.now() + OBSERVATION_TTL_MS,
            }),
      )
      .catch(() => {
        message = 'PR observation coordinator unavailable; retrying'
      })
    args.signal?.throwIfAborted()
    if (!(await this.current({ userId: args.userId, fingerprint }))) return this.changed(args.id)
    args.signal?.throwIfAborted()
    return { keys, available: message === undefined, ...(message === undefined ? {} : { message }) }
  }

  private async authorizeRepo(
    args: GithubObservationAcquire & {
      repo: string
      token: string
      fingerprint: string
      allowRequest: boolean
    },
  ): Promise<RepoResult> {
    const key = authorizationKey({
      userId: args.userId,
      repo: args.repo,
      fingerprint: args.fingerprint,
    })
    let prior: ObservationAuthorization | undefined
    try {
      prior = await this.deps.coordinated(this.deps.adapter.readAuthorization(key))
    } catch {
      return {
        until: 0,
        attempted: false,
        unavailable: true,
        message: 'PR observation authorization coordinator unavailable; retrying',
      }
    }
    args.signal?.throwIfAborted()
    if (prior !== undefined && prior.deniedUntil > Date.now())
      return {
        until: 0,
        attempted: false,
        message: prior.message ?? 'No repository access; retrying after authorization backoff',
      }
    if (
      authorizationAllows(prior) &&
      prior !== undefined &&
      prior.authorizedUntil > Date.now() + 45_000
    )
      return { until: prior.authorizedUntil, attempted: false }
    const retained = authorizationAllows(prior) ? (prior?.authorizedUntil ?? 0) : 0
    if (!args.allowRequest)
      return {
        until: retained,
        attempted: false,
        message: 'Some repository authorizations are deferred; retrying with bounded work',
      }
    let version: number | undefined
    let checkedAt = Date.now()
    try {
      version = await this.deps.coordinated(this.deps.adapter.beginAuthorization(key))
      args.signal?.throwIfAborted()
      if (!(await this.current({ userId: args.userId, fingerprint: args.fingerprint })))
        return { until: 0, attempted: false, changed: true }
      const [owner, repo] = args.repo.split('/') as [string, string]
      checkedAt = Date.now()
      await withGithubRequestBudget({
        store: this.deps.budget,
        run: () =>
          new RepoAccessChecker(async () => args.token).require({
            source: EGithubCallSource.RepoAccess,
            userId: args.userId,
            owner,
            repo,
            signal: args.signal,
          }),
      })
      args.signal?.throwIfAborted()
      if (!(await this.current({ userId: args.userId, fingerprint: args.fingerprint })))
        return { until: 0, attempted: true, changed: true }
      const state = await this.deps.coordinated(
        this.deps.adapter.writeAuthorization({
          key,
          state: {
            version,
            checkedAt,
            authorizedUntil: Date.now() + OBSERVATION_TTL_MS,
            deniedUntil: 0,
          },
        }),
      )
      args.signal?.throwIfAborted()
      return this.result(state)
    } catch (failure) {
      args.signal?.throwIfAborted()
      if (failure instanceof ForbiddenException && version !== undefined) {
        try {
          const state = await this.deps.coordinated(
            this.deps.adapter.writeAuthorization({
              key,
              state: {
                version,
                checkedAt,
                authorizedUntil: 0,
                deniedUntil: Date.now() + OBSERVATION_TTL_MS,
                message: failure.message,
              },
            }),
          )
          return this.result(state)
        } catch {
          return {
            until: 0,
            attempted: true,
            unavailable: true,
            message: 'Repository access denied; shared authorization invalidation unavailable',
          }
        }
      }
      return {
        until: retained,
        attempted: true,
        message:
          failure instanceof Error
            ? failure.message
            : 'Repository authorization unavailable; retrying',
      }
    }
  }

  private result(state: ObservationAuthorization): RepoResult {
    return authorizationAllows(state)
      ? { until: state.authorizedUntil, attempted: true }
      : {
          until: 0,
          attempted: true,
          message: state.message ?? 'Repository authorization superseded; retrying',
        }
  }

  private async current(args: { userId: string; fingerprint: string }): Promise<boolean> {
    const token = await this.deps.github.findToken({ userId: args.userId })
    return token !== undefined && credentialFingerprint(token) === args.fingerprint
  }

  private async changed(id: string): Promise<ObservationAcquisition> {
    await this.release(id).catch(() => undefined)
    return {
      keys: [],
      available: false,
      message:
        'GitHub credential changed or disconnected during observation authorization; retrying',
    }
  }

  private release(id: string): Promise<void> {
    return this.deps.coordinated(this.deps.adapter.remove(id))
  }
}

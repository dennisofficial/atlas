import { EGithubCallSource } from './github-call-log'
import { EGithubHttpStatus, GithubHttpError } from './github-http-error'
import { normalizedRepo } from './github-pr-identity'
import { RepoAccessChecker } from './github-repo-access'
import { withGithubRequestBudget } from './github-request-budget'
import type { GithubRequestCoordinator } from './github-request-coordinator'
import type { GithubService } from './github.service'

export enum ELinkedPrAccess {
  Allowed = 'allowed',
  Denied = 'denied',
  Pending = 'pending',
}

/**
 * One `/repos/{owner}/{repo}` check per (user, repo) token fingerprint, shared with the coordinator's
 * proof cache so the same answer is not bought twice. A budget refusal parks the repo instead of
 * denying it: nothing is recorded and the caller retries later.
 */
export class LinkedPrAccess {
  private readonly inFlight = new Map<string, Promise<ELinkedPrAccess>>()

  constructor(
    private readonly deps: { coordinator: GithubRequestCoordinator; github: GithubService },
  ) {}

  check(args: { userId: string; repoFullName: string }): Promise<ELinkedPrAccess> {
    const repoFullName = normalizedRepo(args.repoFullName)
    const key = `${args.userId}:${repoFullName}`
    const held = this.inFlight.get(key)
    if (held !== undefined) return held

    const asked = this.resolve({ userId: args.userId, repoFullName }).finally(() => {
      this.inFlight.delete(key)
    })
    this.inFlight.set(key, asked)
    return asked
  }

  private async resolve(args: { userId: string; repoFullName: string }): Promise<ELinkedPrAccess> {
    if (await this.deps.coordinator.provenAccess(args)) return ELinkedPrAccess.Allowed
    if (await this.deps.coordinator.deniedAccess(args)) return ELinkedPrAccess.Denied
    const token = await this.deps.github.findToken({ userId: args.userId })
    const [owner, repo] = args.repoFullName.split('/')
    if (token === undefined || owner === undefined || repo === undefined)
      return ELinkedPrAccess.Denied

    try {
      const allowed = await withGithubRequestBudget({
        store: this.deps.coordinator,
        run: () =>
          new RepoAccessChecker(async () => token).require({
            source: EGithubCallSource.RepoAccess,
            userId: args.userId,
            owner,
            repo,
          }),
      })
      if (!allowed) return ELinkedPrAccess.Denied
      await this.deps.coordinator.recordAccess(args)
      return ELinkedPrAccess.Allowed
    } catch (failure) {
      if (!(failure instanceof GithubHttpError) || failure.status !== EGithubHttpStatus.Forbidden)
        return ELinkedPrAccess.Pending
      await this.deps.coordinator.recordDenial({ ...args, message: failure.message })
      return ELinkedPrAccess.Denied
    }
  }
}

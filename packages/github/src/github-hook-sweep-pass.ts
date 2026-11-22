import { db, or } from '@dltech/atlas-db'
import { subscriptionLiveWhere } from './github-delivery-routing'
import type { GithubLogger } from './github-log'
import { repoPattern } from './github-pr-identity'
import { withGithubRequestBudget } from './github-request-budget'
import type { GithubRequestCoordinator } from './github-request-coordinator'
import { ERepoHookStatus } from './github-realtime.types'
import type { GithubHookTeardown } from './github-hook-teardown'

export const IDLE_DELETE_AFTER_MS = 24 * 60 * 60 * 1_000
export const SWEEP_LEASE_MS = 5 * 60 * 1_000

type SweepDeps = {
  teardown: Pick<GithubHookTeardown, 'run'>
  coordinator: GithubRequestCoordinator
  logger: GithubLogger
}

const hasLiveSubscription = async (repoFullName: string): Promise<boolean> =>
  (await db.orm.public.GithubSubscription.where((subscription) =>
    subscription.repoFullName.ilike(repoPattern(repoFullName)),
  )
    .where(subscriptionLiveWhere({ now: new Date() }))
    .first()) !== null

const sweepWithinBudget = async (deps: SweepDeps): Promise<void> => {
  const now = new Date()
  const idleCutoff = new Date(now.getTime() - IDLE_DELETE_AFTER_MS)
  const candidates = await db.orm.public.GithubRepoHook.where((hook) =>
    hook.idleSince.lt(idleCutoff),
  )
    .where({ status: ERepoHookStatus.Active })
    .all()
  for (const candidate of candidates) {
    if (await hasLiveSubscription(candidate.repoFullName)) {
      await db.orm.public.GithubRepoHook.where({
        repoFullName: candidate.repoFullName,
      }).updateAndCount({ idleSince: null })
      continue
    }
    const claimed = await db.orm.public.GithubRepoHook.where({
      repoFullName: candidate.repoFullName,
      status: ERepoHookStatus.Active,
    })
      .where((hook) => or(hook.sweepLeaseUntil.isNull(), hook.sweepLeaseUntil.lt(now)))
      .updateAndCount({
        sweepLeaseUntil: new Date(now.getTime() + SWEEP_LEASE_MS),
        status: ERepoHookStatus.Deleting,
      })
    if (claimed !== 1) continue
    try {
      await deps.teardown.run({ repoFullName: candidate.repoFullName })
    } catch (failure) {
      await db.orm.public.GithubRepoHook.where({
        repoFullName: candidate.repoFullName,
      }).updateAndCount({ status: ERepoHookStatus.Active, sweepLeaseUntil: null })
      deps.logger.warn(`hook cleanup paused: ${String(failure)}`)
      return
    }
  }
}

export const hookSweepPass = (deps: SweepDeps): Promise<void> =>
  withGithubRequestBudget({ store: deps.coordinator, run: () => sweepWithinBudget(deps) })

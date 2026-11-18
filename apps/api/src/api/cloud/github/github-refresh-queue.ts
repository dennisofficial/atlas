import { db, type Row } from '@dltech/atlas-db'
import type { Logger } from '@nestjs/common'
import { cachedPrStates, normalizedRepo, prIdentity, repoPattern } from './github-linked-prs'
import { subscriptionLiveWhere } from './github-delivery-routing'
import type { GithubHookLifecycleService } from './github-hook-lifecycle.service'
import type { GithubRequestCoordinator } from './github-request-coordinator'
import type { TransportSelector } from './github-transport-selector'
import {
  GithubHttpBudgetUnavailable,
  GithubCredentialCooldown,
  withGithubCallCategory,
} from './github-request-budget'
import { GithubUserReadFailed } from './github-user-reads'
import { unsettledHeadExists } from './github-pr-head-checks'
import {
  liveTrackingTargets,
  lookupKey,
  oldestAttemptFirst,
  statesOnPolledHeads,
} from './github-refresh-targets'
import { EGithubHttpCategory } from './github-request-coordinator.types'

type Target = {
  repoFullName: string
  prNumber: number
  userIds: string[]
  pollBacked: boolean
}
type LookupOutcome = 'looked-up' | 'superseded' | 'skipped' | 'rate-limited' | 'credential-limited'
type RefreshOutcome = 'polled' | 'superseded' | 'skipped' | 'rate-limited' | 'credential-limited'

type QueueDeps = {
  coordinator: GithubRequestCoordinator
  hooks: GithubHookLifecycleService
  transport: TransportSelector
  logger: Logger
  resolve: (subscription: Row<'GithubSubscription'>) => Promise<number | null>
  refresh: (args: {
    userId: string
    repoFullName: string
    prNumber: number
  }) => Promise<RefreshOutcome>
  lookUp: (target: Row<'GithubTrackingTarget'>) => Promise<LookupOutcome>
}

export async function refreshGithubQueue(deps: QueueDeps): Promise<void> {
  const now = new Date()
  const tracked = await liveTrackingTargets(now)
  const polls = new Map<string, boolean>()
  const pollsIn = async (repoFullName: string): Promise<boolean> => {
    const repo = normalizedRepo(repoFullName)
    const held = polls.get(repo)
    if (held !== undefined) return held
    const answer = await deps.transport.polls(repo)
    polls.set(repo, answer)
    return answer
  }
  const polledHeads: Row<'GithubTrackingTarget'>[] = []
  const firstLookups: Row<'GithubTrackingTarget'>[] = []
  for (const target of tracked) {
    if (target.kind === 'head' && (await pollsIn(target.repoFullName))) {
      polledHeads.push(target)
      continue
    }
    if (target.lookedUpAt === null) firstLookups.push(target)
  }
  await lookUpEach({ deps, targets: [...firstLookups, ...polledHeads].sort(oldestAttemptFirst) })
  const subscriptions = await db.orm.public.GithubSubscription.where(
    subscriptionLiveWhere({ now }),
  ).all()
  const targets = new Map<string, Target>()
  const add = (target: Target) => {
    const key = prIdentity(target)
    const prior = targets.get(key)
    targets.set(key, {
      ...target,
      repoFullName: normalizedRepo(target.repoFullName),
      userIds: [...new Set([...(prior?.userIds ?? []), ...target.userIds])],
      pollBacked: target.pollBacked || prior?.pollBacked === true,
    })
  }
  const branches = new Map<string, Row<'GithubSubscription'>[]>()
  for (const row of subscriptions) {
    if (row.prNumber !== null) {
      add({ ...row, prNumber: row.prNumber, userIds: [row.userId] })
      continue
    }
    if (!row.pollBacked || !(await pollsIn(row.repoFullName))) continue
    const key = `${normalizedRepo(row.repoFullName)}:${row.branch}`
    branches.set(key, [...(branches.get(key) ?? []), row])
  }
  for (const [key, rows] of rotated([...branches.entries()])) {
    if ((await deps.coordinator.attempt({ key })).nextAttemptAt > Date.now()) continue
    let failed = true
    try {
      for (const row of rows) {
        const number = await deps
          .resolve({
            ...row,
            repoFullName: normalizedRepo(row.repoFullName),
          })
          .catch((failure: unknown) => {
            if (credentialLimited(failure)) return null
            throw failure
          })
        if (number === null) continue
        for (const subscription of rows) {
          await db.orm.public.GithubSubscription.where({ id: subscription.id }).update({
            prNumber: number,
          })
          add({
            ...subscription,
            prNumber: number,
            userIds: [subscription.userId],
          })
        }
        failed = false
        break
      }
    } finally {
      await deps.coordinator.recordAttempt({ key, failed })
    }
  }
  for (const found of await statesOnPolledHeads(polledHeads)) {
    add({
      repoFullName: found.state.repoFullName,
      prNumber: found.state.prNumber,
      userIds: [found.userId],
      pollBacked: true,
    })
  }
  const states = new Map(
    (await cachedPrStates([...targets.values()])).map((state) => [prIdentity(state), state]),
  )
  const ordered = (
    await Promise.all(
      [...targets.values()].map(async (target) => {
        const state = states.get(prIdentity(target))
        if (state === undefined || state.state !== 'merged') return target
        return (await mergedAwaitingVerdict(state)) ? target : null
      }),
    )
  )
    .filter((target) => target !== null)
    .sort(
      (a, b) =>
        Date.parse(states.get(prIdentity(a))?.updatedAt ?? '1970-01-01') -
        Date.parse(states.get(prIdentity(b))?.updatedAt ?? '1970-01-01'),
    )
  const hooks = new Map<string, boolean>()
  for (const target of rotated(ordered)) {
    if (!(await pollsIn(target.repoFullName))) continue
    const key = prIdentity(target)
    if ((await deps.coordinator.attempt({ key })).nextAttemptAt > Date.now()) continue
    const state = states.get(key)
    const age = state === undefined ? Infinity : Date.now() - Date.parse(state.updatedAt)
    if (!target.pollBacked && age < 600_000) continue
    let failed = true
    try {
      for (const userId of target.userIds) {
        let hookBacked = hooks.get(target.repoFullName)
        if (hookBacked === undefined) {
          const result = await deps.hooks
            .ensureHook({ userId, repoFullName: target.repoFullName })
            .catch((failure: unknown) => {
              if (credentialLimited(failure)) return undefined
              throw failure
            })
          if (result === undefined) continue
          hookBacked = result !== 'poll-backed'
          hooks.set(target.repoFullName, hookBacked)
          await db.orm.public.GithubRepoHook.where((hook) =>
            hook.repoFullName.ilike(repoPattern(target.repoFullName)),
          ).updateAndCount({ idleSince: null })
        }
        if (hookBacked && !target.pollBacked && age < 600_000) {
          failed = false
          break
        }
        const result = await deps.refresh({
          userId,
          repoFullName: target.repoFullName,
          prNumber: target.prNumber,
        })
        if (result === 'rate-limited') return
        if (result === 'credential-limited') continue
        if (result === 'polled' || result === 'superseded') {
          failed = false
          break
        }
      }
    } catch (failure) {
      if (credentialLimited(failure)) continue
      if (
        failure instanceof GithubHttpBudgetUnavailable ||
        (failure instanceof GithubUserReadFailed && failure.rateLimited)
      )
        return
      deps.logger.warn(`refreshing ${key} failed: ${String(failure)}`)
    } finally {
      await deps.coordinator.recordAttempt({ key, failed })
    }
  }
  const activeRepos = new Set(subscriptions.map((row) => normalizedRepo(row.repoFullName)))
  const held = await db.orm.public.GithubRepoHook.where({ idleSince: null }).all()
  for (const hook of held) {
    if (activeRepos.has(normalizedRepo(hook.repoFullName))) continue
    await db.orm.public.GithubRepoHook.where({ repoFullName: hook.repoFullName }).updateAndCount({
      idleSince: new Date(),
    })
  }
}

async function lookUpEach(args: {
  deps: QueueDeps
  targets: readonly Row<'GithubTrackingTarget'>[]
}): Promise<void> {
  await withGithubCallCategory(EGithubHttpCategory.Lookup, async () => {
    for (const target of args.targets) {
      const key = lookupKey(target)
      if ((await args.deps.coordinator.attempt({ key })).nextAttemptAt > Date.now()) continue
      let failed = true
      try {
        const result = await args.deps.lookUp(target)
        if (result === 'rate-limited') return
        failed = result !== 'looked-up' && result !== 'superseded'
      } finally {
        await args.deps.coordinator.recordAttempt({ key, failed })
      }
    }
  })
}

/**
 * A merged PR keeps a refresh slot while its head still owes a verdict, for a short window after
 * the merge: the final CI result commonly lands post-merge, and dropping the target the moment it
 * merges closes the only repair path (#1635). Once the verdict obligation is discharged or the
 * window passes, the PR leaves the queue for good.
 */
export const MERGED_UNSETTLED_WINDOW_MS = 30 * 60 * 1_000

async function mergedAwaitingVerdict(state: {
  repoFullName: string
  prNumber: number
  headSha: string
  updatedAt: string
}): Promise<boolean> {
  if (Date.now() - Date.parse(state.updatedAt) > MERGED_UNSETTLED_WINDOW_MS) return false
  return unsettledHeadExists({
    repoFullName: normalizedRepo(state.repoFullName),
    prNumber: state.prNumber,
    headSha: state.headSha,
  })
}

function credentialLimited(failure: unknown): boolean {
  return (
    failure instanceof GithubCredentialCooldown ||
    (failure instanceof GithubUserReadFailed &&
      (failure.rateLimited || [401, 403, 404].includes(failure.status)))
  )
}

function rotated<T>(items: T[]): T[] {
  if (items.length === 0) return []
  const offset = (Math.floor(Date.now() / 60_000) * 128) % items.length
  return [...items.slice(offset), ...items.slice(0, offset)].slice(0, 128)
}

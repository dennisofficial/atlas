import { db, type Row } from '@dltech/atlas-db'
import type { Logger } from '@nestjs/common'
import { cachedPrStates, normalizedRepo, prIdentity, repoPattern } from './github-linked-prs'
import { subscriptionLiveWhere } from './github-delivery-routing'
import type { GithubHookLifecycleService } from './github-hook-lifecycle.service'
import type { GithubObservationStore } from './github-observation.store'
import { GithubHttpBudgetUnavailable, GithubCredentialCooldown } from './github-request-budget'
import { GithubUserReadFailed } from './github-user-reads'

type Target = {
  repoFullName: string
  prNumber: number
  userIds: string[]
  pollBacked: boolean
  observed: boolean
}
type QueueDeps = {
  observations: GithubObservationStore
  hooks: GithubHookLifecycleService
  logger: Logger
  resolve: (subscription: Row<'GithubSubscription'>) => Promise<number | null>
  refresh: (args: {
    userId: string
    repoFullName: string
    prNumber: number
  }) => Promise<'polled' | 'skipped' | 'rate-limited' | 'credential-limited'>
}

export async function refreshGithubQueue(deps: QueueDeps): Promise<void> {
  const subscriptions = await db.orm.public.GithubSubscription.where(
    subscriptionLiveWhere({ now: new Date() }),
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
      observed: target.observed || prior?.observed === true,
    })
  }
  for (const observer of await deps.observations.targets())
    add({ ...observer, pollBacked: false, observed: true })
  const branches = new Map<string, Row<'GithubSubscription'>[]>()
  for (const row of subscriptions) {
    if (row.prNumber !== null) {
      add({ ...row, prNumber: row.prNumber, userIds: [row.userId], observed: false })
      continue
    }
    if (!row.pollBacked) continue
    const key = `${normalizedRepo(row.repoFullName)}:${row.branch}`
    branches.set(key, [...(branches.get(key) ?? []), row])
  }
  for (const [key, rows] of rotated([...branches.entries()])) {
    if ((await deps.observations.attempt({ key })).nextAttemptAt > Date.now()) continue
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
            observed: false,
          })
        }
        failed = false
        break
      }
    } finally {
      await deps.observations.recordAttempt({ key, failed })
    }
  }
  const states = new Map(
    (await cachedPrStates([...targets.values()])).map((state) => [prIdentity(state), state]),
  )
  const ordered = [...targets.values()]
    .filter((target) => states.get(prIdentity(target))?.state !== 'merged')
    .sort(
      (a, b) =>
        Date.parse(states.get(prIdentity(a))?.updatedAt ?? '1970-01-01') -
        Date.parse(states.get(prIdentity(b))?.updatedAt ?? '1970-01-01'),
    )
  const hooks = new Map<string, boolean>()
  for (const target of rotated(ordered)) {
    const key = prIdentity(target)
    if ((await deps.observations.attempt({ key })).nextAttemptAt > Date.now()) continue
    const state = states.get(key)
    const age = state === undefined ? Infinity : Date.now() - Date.parse(state.updatedAt)
    if (!target.pollBacked && age < (target.observed ? 60_000 : 600_000)) continue
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
        if (result === 'polled') {
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
      await deps.observations.recordAttempt({ key, failed })
    }
  }
  const activeRepos = new Set(subscriptions.map((row) => normalizedRepo(row.repoFullName)))
  const held = await db.orm.public.GithubRepoHook.where({ idleSince: null }).all()
  for (const hook of held) {
    if (
      activeRepos.has(normalizedRepo(hook.repoFullName)) ||
      (await deps.observations.hasRepo({ repoFullName: hook.repoFullName }))
    )
      continue
    await db.orm.public.GithubRepoHook.where({ repoFullName: hook.repoFullName }).updateAndCount({
      idleSince: new Date(),
    })
  }
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

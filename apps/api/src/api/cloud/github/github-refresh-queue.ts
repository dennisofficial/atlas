import { db, type Row } from '@dltech/atlas-db'
import type { Logger } from '@nestjs/common'
import { ETargetOutcome, ETrackingTransport } from '@dltech/atlas-core'
import { ERepoTracking } from '@dltech/atlas-wire'
import { normalizedRepo, repoPattern } from './github-linked-prs'
import { subscriptionLiveWhere } from './github-delivery-routing'
import type { GithubHookLifecycleService } from './github-hook-lifecycle.service'
import type { TransportSelector } from './github-transport-selector'
import { CLAIM_BATCH, claimedTargets, settleTarget } from './github-due-scheduler'
import {
  GithubCredentialCooldown,
  GithubHttpBudgetUnavailable,
  isGithubBudgetParked,
  withGithubCallCategory,
} from './github-request-budget'
import { GithubUserReadFailed } from './github-user-reads'
import { unsettledHeadExists } from './github-pr-head-checks'
import { EGithubHttpCategory } from './github-request-coordinator.types'

export type TargetAttempt = { outcome: ETargetOutcome; retryAtMs?: number | undefined }

export type QueueDeps = {
  hooks: GithubHookLifecycleService
  transport: TransportSelector
  logger: Logger
  resolve: (subscription: Row<'GithubSubscription'>) => Promise<number | null>
  refresh: (args: {
    userId: string
    repoFullName: string
    prNumber: number
  }) => Promise<TargetAttempt>
  lookUp: (
    target: Row<'GithubTrackingTarget'>,
    transport: ETrackingTransport,
  ) => Promise<TargetAttempt>
}

const transportOf = async (
  transport: TransportSelector,
  repoFullName: string,
): Promise<ETrackingTransport> => {
  const tracking = await transport.transportOf(repoFullName)
  if (tracking === ERepoTracking.Polled) return ETrackingTransport.Polled
  if (tracking === ERepoTracking.App) return ETrackingTransport.AppWebhook
  return ETrackingTransport.UserWebhook
}

export const parkedAttemptOf = (failure: unknown, logger: Logger): TargetAttempt => {
  if (failure instanceof GithubCredentialCooldown)
    return { outcome: ETargetOutcome.CredentialLimited, retryAtMs: failure.until }
  if (isGithubBudgetParked(failure) || failure instanceof GithubHttpBudgetUnavailable)
    return {
      outcome: ETargetOutcome.BudgetRefused,
      retryAtMs: failure instanceof GithubHttpBudgetUnavailable ? failure.until : undefined,
    }
  if (failure instanceof GithubUserReadFailed)
    return {
      outcome: failure.rateLimited ? ETargetOutcome.CredentialLimited : ETargetOutcome.Failed,
    }
  logger.warn(`tracking target failed; retrying on its own backoff: ${String(failure)}`)
  return { outcome: ETargetOutcome.Failed }
}

export async function refreshGithubQueue(args: {
  deps: QueueDeps
  now: Date
  limit?: number | undefined
}): Promise<void> {
  await seedSubscriptionTargets({ deps: args.deps, now: args.now })
  const claimed = await claimedTargets({ now: args.now, limit: args.limit ?? CLAIM_BATCH })
  const attempted = new Set<string>()
  for (const target of claimed) {
    const identity = `${normalizedRepo(target.repoFullName)}#${target.prNumber}`
    const duplicate = target.prNumber > 0 && attempted.has(identity)
    if (target.prNumber > 0) attempted.add(identity)
    const { attempt, transport } = duplicate
      ? { attempt: { outcome: ETargetOutcome.LookedUp }, transport: ETrackingTransport.Polled }
      : await attemptOf({ deps: args.deps, target })
    const verdict = await verdictOutcomeOf({ attempt, target })
    await settleTarget({
      target,
      now: args.now,
      transport,
      outcome: verdict?.outcome ?? attempt.outcome,
      retryAtMs: attempt.retryAtMs,
      mergedAtMs: verdict?.mergedAtMs,
    })
  }
  await releaseIdleHooks()
}

async function attemptOf(args: {
  deps: QueueDeps
  target: Row<'GithubTrackingTarget'>
}): Promise<{ attempt: TargetAttempt; transport: ETrackingTransport }> {
  let transport = ETrackingTransport.Polled
  try {
    transport = await transportOf(args.deps.transport, args.target.repoFullName)
    const settled = await settledMergeOf(args.target)
    if (settled !== undefined) return { attempt: settled, transport }
    if (await restingOnWebhook(args.target, transport))
      return { attempt: { outcome: ETargetOutcome.LookedUp }, transport }
    const firstFill = args.target.kind === 'head' || !(await subscribed(args.target))
    if (firstFill && args.target.lookedUpAt === null)
      return {
        attempt: await withGithubCallCategory(EGithubHttpCategory.Lookup, () =>
          args.deps.lookUp(args.target, transport),
        ),
        transport,
      }
    if (transport !== ETrackingTransport.Polled) {
      await coverTarget({ deps: args.deps, target: args.target })
      return { attempt: { outcome: ETargetOutcome.LookedUp }, transport }
    }
    if (args.target.kind === 'head')
      return {
        attempt: await withGithubCallCategory(EGithubHttpCategory.Lookup, () =>
          args.deps.lookUp(args.target, transport),
        ),
        transport,
      }
    return {
      attempt: await args.deps.refresh({
        userId: args.target.userId,
        repoFullName: normalizedRepo(args.target.repoFullName),
        prNumber: args.target.prNumber,
      }),
      transport,
    }
  } catch (failure) {
    return { attempt: parkedAttemptOf(failure, args.deps.logger), transport }
  }
}

const COVERED_RECHECK_MS = 10 * 60 * 1_000

async function coverTarget(args: {
  deps: QueueDeps
  target: Row<'GithubTrackingTarget'>
}): Promise<void> {
  const result = await args.deps.hooks.ensureHook({
    userId: args.target.userId,
    repoFullName: args.target.repoFullName,
  })
  if (result === undefined) return
  await db.orm.public.GithubRepoHook.where((hook) =>
    hook.repoFullName.ilike(repoPattern(args.target.repoFullName)),
  ).updateAndCount({ idleSince: null })
}

async function settledMergeOf(
  target: Row<'GithubTrackingTarget'>,
): Promise<TargetAttempt | undefined> {
  if (target.prNumber <= 0) return undefined
  const state = await stateOf(target)
  if (state === null || state === undefined || state.state !== 'merged') return undefined
  const settled = !(await unsettledHeadExists({
    repoFullName: normalizedRepo(target.repoFullName),
    prNumber: target.prNumber,
    headSha: state.headSha,
  }))
  const withinWindow = Date.now() - new Date(state.updatedAt).getTime() <= MERGED_SETTLE_WINDOW_MS
  if (!settled && withinWindow) return undefined
  return { outcome: ETargetOutcome.TerminalSettled }
}

async function subscribed(target: Row<'GithubTrackingTarget'>): Promise<boolean> {
  if (target.prNumber <= 0) return false
  const row = await db.orm.public.GithubSubscription.where({ prNumber: target.prNumber }).first()
  if (row === null || row === undefined) return false
  return normalizedRepo(row.repoFullName) === normalizedRepo(target.repoFullName)
}

async function restingOnWebhook(
  target: Row<'GithubTrackingTarget'>,
  transport: ETrackingTransport,
): Promise<boolean> {
  if (transport !== ETrackingTransport.Polled || target.prNumber <= 0) return false
  const subscription = await db.orm.public.GithubSubscription.where({
    prNumber: target.prNumber,
  }).first()
  if (subscription === null || subscription === undefined || subscription.pollBacked) return false
  if (normalizedRepo(subscription.repoFullName) !== normalizedRepo(target.repoFullName))
    return false
  return !(await stateIsStale(target))
}

const stateOf = (target: Row<'GithubTrackingTarget'>) =>
  db.orm.public.GithubPrState.where({
    repoFullName: normalizedRepo(target.repoFullName),
    prNumber: target.prNumber,
  }).first()

export const MERGED_SETTLE_WINDOW_MS = 30 * 60 * 1_000

async function stateIsStale(target: Row<'GithubTrackingTarget'>): Promise<boolean> {
  if (target.prNumber <= 0) return true
  const state = await stateOf(target)
  if (state === null || state === undefined) return true
  return Date.now() - new Date(state.updatedAt).getTime() > COVERED_RECHECK_MS
}

async function verdictOutcomeOf(args: {
  attempt: TargetAttempt
  target: Row<'GithubTrackingTarget'>
}): Promise<{ outcome: ETargetOutcome; mergedAtMs: number } | undefined> {
  if (
    args.target.prNumber <= 0 ||
    (args.attempt.outcome !== ETargetOutcome.Polled &&
      args.attempt.outcome !== ETargetOutcome.LookedUp)
  )
    return undefined
  const state = await stateOf(args.target)
  if (state === undefined || state === null || state.state !== 'merged') return undefined
  const mergedAtMs = new Date(state.updatedAt).getTime()
  const unsettled = await unsettledHeadExists({
    repoFullName: normalizedRepo(args.target.repoFullName),
    prNumber: args.target.prNumber,
    headSha: state.headSha,
  })
  return {
    outcome: unsettled ? ETargetOutcome.MergedUnsettled : ETargetOutcome.TerminalSettled,
    mergedAtMs,
  }
}

async function seedSubscriptionTargets(args: { deps: QueueDeps; now: Date }): Promise<void> {
  const subscriptions = await db.orm.public.GithubSubscription.where(
    subscriptionLiveWhere({ now: args.now }),
  ).all()
  const branches = new Map<string, Row<'GithubSubscription'>[]>()
  for (const row of subscriptions) {
    if (row.prNumber !== null) {
      await dueTarget({ row, number: row.prNumber, now: args.now })
      continue
    }
    if (!row.pollBacked) continue
    if (!(await args.deps.transport.polls(row.repoFullName))) continue
    const key = `${normalizedRepo(row.repoFullName)}:${row.branch}`
    branches.set(key, [...(branches.get(key) ?? []), row])
  }
  for (const rows of branches.values()) {
    const number = await resolvedNumber({ deps: args.deps, rows })
    if (number === null) continue
    for (const row of rows) {
      await db.orm.public.GithubSubscription.where({ id: row.id }).update({ prNumber: number })
      await dueTarget({ row, number, now: args.now })
    }
  }
}

async function resolvedNumber(args: {
  deps: QueueDeps
  rows: readonly Row<'GithubSubscription'>[]
}): Promise<number | null> {
  for (const row of args.rows) {
    try {
      const number = await args.deps.resolve({
        ...row,
        repoFullName: normalizedRepo(row.repoFullName),
      })
      if (number !== null) return number
    } catch (failure) {
      if (failure instanceof GithubCredentialCooldown) continue
      if (isGithubBudgetParked(failure)) continue
      throw failure
    }
  }
  return null
}

export const ensurePullTarget = async (args: {
  userId: string
  repoFullName: string
  prNumber: number
  liveUntil: Date
  now: Date
}): Promise<void> => {
  await db.orm.public.GithubTrackingTarget.upsert({
    conflictOn: {
      userId: args.userId,
      kind: 'pull-request',
      repoFullName: normalizedRepo(args.repoFullName),
      branch: '',
      prNumber: args.prNumber,
    },
    create: {
      userId: args.userId,
      kind: 'pull-request',
      repoFullName: normalizedRepo(args.repoFullName),
      branch: '',
      prNumber: args.prNumber,
      liveUntil: args.liveUntil,
      nextDueAt: args.now,
    },
    update: { liveUntil: args.liveUntil },
  })
}

async function dueTarget(args: {
  row: Row<'GithubSubscription'>
  number: number
  now: Date
}): Promise<void> {
  const key = {
    userId: args.row.userId,
    kind: 'pull-request' as const,
    repoFullName: normalizedRepo(args.row.repoFullName),
    branch: '',
    prNumber: args.number,
  }
  await db.orm.public.GithubTrackingTarget.upsert({
    conflictOn: key,
    create: { ...key, liveUntil: args.row.liveUntil, nextDueAt: args.now },
    update: { liveUntil: args.row.liveUntil },
  })
}

async function releaseIdleHooks(): Promise<void> {
  const active = new Set(
    (
      await db.orm.public.GithubSubscription.where(subscriptionLiveWhere({ now: new Date() })).all()
    ).map((row) => normalizedRepo(row.repoFullName)),
  )
  const held = await db.orm.public.GithubRepoHook.where({ idleSince: null }).all()
  for (const hook of held) {
    if (active.has(normalizedRepo(hook.repoFullName))) continue
    await db.orm.public.GithubRepoHook.where({ repoFullName: hook.repoFullName }).updateAndCount({
      idleSince: new Date(),
    })
  }
}

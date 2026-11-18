import { db, type Row } from '@dltech/atlas-db'
import type { Logger } from '@nestjs/common'
import { ETargetOutcome, ETrackingTransport } from '@dltech/atlas-core'
import { ERepoTracking } from '@dltech/atlas-wire'
import { normalizedRepo, repoPattern } from './github-linked-prs'
import type { GithubHookLifecycleService } from './github-hook-lifecycle.service'
import type { TransportSelector } from './github-transport-selector'
import {
  CLAIM_BATCH,
  claimedTargets,
  type ClaimedTarget,
  renewClaim,
  settleTarget,
} from './github-due-scheduler'
import { releaseIdleHooks, seedSubscriptionTargets } from './github-refresh-seed'
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
  await seedSubscriptionTargets({ transport: args.deps.transport, now: args.now })
  const claimed = await claimedTargets({ now: args.now, limit: args.limit ?? CLAIM_BATCH })
  const attempted = new Set<string>()
  for (const target of claimed) {
    const held = await renewClaim({ id: target.id, leaseToken: target.leaseToken, now: new Date() })
    if (held === 0) continue
    const identity = `${normalizedRepo(target.repoFullName)}#${target.prNumber}`
    const duplicate = target.prNumber > 0 && attempted.has(identity)
    if (target.prNumber > 0) attempted.add(identity)
    const { attempt, transport } = duplicate
      ? { attempt: { outcome: ETargetOutcome.LookedUp }, transport: ETrackingTransport.Polled }
      : await attemptOf({ deps: args.deps, target })
    const verdict = await verdictOutcomeOf({ attempt, target })
    await settleTarget({
      target,
      now: new Date(),
      transport,
      outcome: verdict?.outcome ?? attempt.outcome,
      retryAtMs: attempt.retryAtMs,
      mergedAtMs: verdict?.mergedAtMs,
    })
  }
  await releaseIdleHooks(new Date())
}

async function attemptOf(args: {
  deps: QueueDeps
  target: ClaimedTarget
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

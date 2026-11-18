export enum ETrackingTransport {
  AppWebhook = 'app',
  UserWebhook = 'user',
  Polled = 'polled',
}

export enum ETargetKind {
  Head = 'head',
  PullRequest = 'pull-request',
}

export enum ETargetOutcome {
  LookedUp = 'looked-up',
  Polled = 'polled',
  NotFound = 'not-found',
  Superseded = 'superseded',
  BudgetRefused = 'budget-refused',
  CredentialLimited = 'credential-limited',
  Failed = 'failed',
  TerminalSettled = 'terminal-settled',
  MergedUnsettled = 'merged-unsettled',
}

export const TRACKING_BACKOFF_BASE_MS = 30_000
export const TRACKING_BACKOFF_MAX_MS = 15 * 60 * 1_000
export const TRACKING_COVERED_RECHECK_MS = 10 * 60 * 1_000
export const TRACKING_POLLED_HEAD_MS = 60_000
export const TRACKING_POLLED_PULL_MS = 30_000
export const TRACKING_MERGED_SETTLED_MS = 30_000
export const TRACKING_MERGED_SETTLE_WINDOW_MS = 30 * 60 * 1_000
export const TRACKING_REFUSAL_RETRY_MS = 60_000

const backoffOf = (failures: number): number =>
  Math.min(TRACKING_BACKOFF_BASE_MS * 2 ** failures, TRACKING_BACKOFF_MAX_MS)

const handledByCoverage = (args: {
  outcome: ETargetOutcome
  transport: ETrackingTransport
  lookedUp: boolean
}): boolean =>
  args.lookedUp &&
  args.transport !== ETrackingTransport.Polled &&
  (args.outcome === ETargetOutcome.LookedUp ||
    args.outcome === ETargetOutcome.Polled ||
    args.outcome === ETargetOutcome.Superseded)

const dueOf = (args: {
  nowMs: number
  kind: ETargetKind
  transport: ETrackingTransport
  lookedUp: boolean
  outcome: ETargetOutcome
  failures: number
  retryAtMs?: number | undefined
  liveUntilMs: number
  mergedAtMs?: number | undefined
}): { nextDueAt: number; failures: number } => {
  if (args.outcome === ETargetOutcome.TerminalSettled)
    return { nextDueAt: args.liveUntilMs, failures: args.failures }
  if (
    args.outcome === ETargetOutcome.BudgetRefused ||
    args.outcome === ETargetOutcome.CredentialLimited
  )
    return {
      nextDueAt: args.retryAtMs ?? args.nowMs + TRACKING_REFUSAL_RETRY_MS,
      failures: args.failures,
    }
  if (args.outcome === ETargetOutcome.Failed || args.outcome === ETargetOutcome.NotFound)
    return {
      nextDueAt: Math.min(args.nowMs + backoffOf(args.failures), args.liveUntilMs),
      failures: args.failures + 1,
    }
  if (args.outcome === ETargetOutcome.MergedUnsettled) {
    const mergedAtMs = args.mergedAtMs
    const settling =
      mergedAtMs !== undefined && args.nowMs - mergedAtMs <= TRACKING_MERGED_SETTLE_WINDOW_MS
    return {
      nextDueAt: settling ? args.nowMs + TRACKING_MERGED_SETTLED_MS : args.liveUntilMs,
      failures: args.failures,
    }
  }
  if (handledByCoverage(args))
    return { nextDueAt: args.nowMs + TRACKING_COVERED_RECHECK_MS, failures: 0 }
  return {
    nextDueAt:
      args.nowMs +
      (args.kind === ETargetKind.Head ? TRACKING_POLLED_HEAD_MS : TRACKING_POLLED_PULL_MS),
    failures: 0,
  }
}

export function nextDueOf(args: {
  nowMs: number
  kind: ETargetKind
  transport: ETrackingTransport
  lookedUp: boolean
  outcome: ETargetOutcome
  failures: number
  retryAtMs?: number | undefined
  liveUntilMs: number
  mergedAtMs?: number | undefined
}): { nextDueAt: number; failures: number } {
  const due = dueOf(args)
  return {
    nextDueAt: Math.max(Math.min(due.nextDueAt, args.liveUntilMs), args.nowMs),
    failures: due.failures,
  }
}

import type { OpenTurn } from '../turns'
import { hasBackground } from './background-facts'
import type { StatusFacts } from './status-facts'
import { queuedSinceOf, type PendingInputsState } from '../pending-inputs'
import { ESessionStatus, type SessionStatus } from './status-types'

const workspaceStatusOf = (args: {
  facts: StatusFacts
  messageAfterFailure: boolean
}): SessionStatus | undefined => {
  const { facts } = args
  if ((facts.firstSeq ?? 1) > 1 || facts.prepared) return undefined
  const failure = facts.prepareFailure
  if (failure === null || args.messageAfterFailure) return { state: ESessionStatus.Preparing }
  return { state: ESessionStatus.SetupFailed, reason: failure.reason, since: failure.at }
}

const pendingRetry = (args: { facts: StatusFacts; nowMs: number }) =>
  args.facts.retries.findLast((retry) => Date.parse(retry.notBefore) > args.nowMs)

const sinceWithinTurn = (args: { facts: StatusFacts; open: OpenTurn }): string => {
  const at = args.facts.turn?.at
  if (at === undefined) return args.open.startedAt
  return Date.parse(at) >= Date.parse(args.open.startedAt) ? at : args.open.startedAt
}

const openTurnStatus = (args: {
  facts: StatusFacts
  live: boolean
  nowMs: number
}): SessionStatus | undefined => {
  const { facts, live, nowMs } = args
  const open = facts.openTurn
  if (open === null) return undefined
  const turn = facts.turn
  const since = sinceWithinTurn({ facts, open })

  const wait = facts.credentialWait
  if (wait !== null) {
    return {
      state: ESessionStatus.WaitingForCredentials,
      reason: wait.reason ?? undefined,
      since: wait.at,
    }
  }

  const retry = pendingRetry({ facts, nowMs })
  if (retry !== undefined) {
    return {
      state: ESessionStatus.WaitingToRetry,
      reason: `retrying at ${retry.notBefore}`,
      since: retry.at,
    }
  }

  const parked = Object.values(facts.parked)[0]
  if (parked !== undefined) {
    return { state: ESessionStatus.WaitingForOperator, reason: parked.name, since: parked.at }
  }

  if (turn?.type === 'tool-dispatched') {
    return { state: ESessionStatus.RunningTool, reason: turn.toolName ?? undefined, since }
  }
  if (turn?.type === 'tool-called' || turn?.type === 'tool-denied') {
    return { state: ESessionStatus.Thinking, since }
  }
  if (!live) return { state: ESessionStatus.Resuming, since }
  return { state: ESessionStatus.Thinking, since }
}

const idleSinceOf = (facts: StatusFacts): string | undefined =>
  facts.lastTurnEnd?.at ?? facts.turn?.at

export function deriveStatus(args: {
  facts: StatusFacts
  live: boolean
  queuedSince: string | null
  pending?: PendingInputsState | undefined
  messageAfterFailure?: boolean | undefined
  now: string
}): SessionStatus {
  const { facts } = args
  const logQueuedSince = args.pending === undefined ? null : queuedSinceOf(args.pending)
  const queuedSince = logQueuedSince ?? args.queuedSince

  const queued: SessionStatus =
    queuedSince === null
      ? { state: ESessionStatus.Queued }
      : { state: ESessionStatus.Queued, since: queuedSince }

  const startFailure = facts.startFailure
  if (startFailure !== null) {
    if (args.messageAfterFailure === true) return queued
    return {
      state: ESessionStatus.StartFailed,
      reason: startFailure.reason,
      since: startFailure.at,
    }
  }

  const workspace =
    args.messageAfterFailure === undefined
      ? undefined
      : workspaceStatusOf({ facts, messageAfterFailure: args.messageAfterFailure })
  if (workspace !== undefined) return workspace

  if (queuedSince !== null) return queued

  const failed = facts.unfinishedFailure
  if (failed !== null) {
    return { state: ESessionStatus.Failed, reason: failed.message, since: failed.at }
  }

  const open = openTurnStatus({ facts, live: args.live, nowMs: Date.parse(args.now) })
  if (open !== undefined) return open
  if (hasBackground(facts.background)) {
    const state = args.live ? ESessionStatus.WaitingForBackground : ESessionStatus.Resuming
    return { state, since: idleSinceOf(facts) }
  }
  return { state: ESessionStatus.Idle, since: idleSinceOf(facts) }
}

import type { StatusFacts } from './status-facts'
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

const openTurnStatus = (args: {
  facts: StatusFacts
  live: boolean
  nowMs: number
}): SessionStatus | undefined => {
  const { facts, live, nowMs } = args
  const turn = facts.turn
  if (turn === null || turn.endsTurn || facts.stopAfterTurn) return undefined

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

  if (turn.type === 'tool-dispatched') {
    return { state: ESessionStatus.RunningTool, reason: turn.toolName ?? undefined, since: turn.at }
  }
  if (turn.type === 'tool-called' || turn.type === 'tool-denied') {
    return { state: ESessionStatus.Thinking, since: turn.at }
  }
  if (!live) return { state: ESessionStatus.Resuming, since: turn.at }
  return { state: ESessionStatus.Thinking, since: turn.at }
}

export function deriveStatus(args: {
  facts: StatusFacts
  live: boolean
  unconsumedInbox: boolean
  messageAfterFailure?: boolean | undefined
  now: string
}): SessionStatus {
  const { facts } = args

  const startFailure = facts.startFailure
  if (startFailure !== null) {
    if (args.messageAfterFailure === true) return { state: ESessionStatus.Sent }
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

  if (args.unconsumedInbox) return { state: ESessionStatus.Sent }

  const failed = facts.unfinishedFailure
  if (failed !== null) {
    return { state: ESessionStatus.Failed, reason: failed.message, since: failed.at }
  }

  const open = openTurnStatus({ facts, live: args.live, nowMs: Date.parse(args.now) })
  if (open !== undefined) return open
  return { state: ESessionStatus.Idle, since: facts.turn?.at }
}

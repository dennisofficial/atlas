import { EWaitEpisodeKind } from '../model-recovery/waiting'
import { EFinishReason } from '../stream/chunk'
import { EInputConsumed, type RecordBody, type V2Event } from './event'
import { retryDeadlineAfter } from './retry-scheduled'
import { activeStartFailure } from './start-failure'
import { isWorkspacePrepared, lastPrepareFailure } from './workspace'

export enum ESessionStatus {
  Preparing = 'preparing',
  SetupFailed = 'setup-failed',
  Sent = 'sent',
  Thinking = 'thinking',
  RunningTool = 'running-tool',
  WaitingToRetry = 'waiting-to-retry',
  WaitingForCredentials = 'waiting-for-credentials',
  Resuming = 'resuming',
  Idle = 'idle',
  Failed = 'failed',
}

export type SessionStatus = {
  state: ESessionStatus
  reason?: string | undefined
  since?: string | undefined
}

const TURN_ENDING_TYPES: ReadonlySet<V2Event['type']> = new Set([
  'run-failed',
  'run-failure-dismissed',
  'workspace-prepared',
  'workspace-prepare-failed',
  'session-start-failed',
])

const endsTurn = (event: Extract<V2Event, { type: 'assistant-said' }>): boolean =>
  event.aborted !== 'handoff' && event.finish !== EFinishReason.ToolCalls

const isTurnEnding = (event: V2Event): boolean =>
  TURN_ENDING_TYPES.has(event.type) || (event.type === 'assistant-said' && endsTurn(event))

const TURN_NEUTRAL_TYPES: ReadonlySet<V2Event['type']> = new Set<RecordBody['type']>([
  'branches-observed',
  'fact-recorded',
  'retry-scheduled',
  'input-consumed',
])

const isTurnNeutral = (event: V2Event): boolean => TURN_NEUTRAL_TYPES.has(event.type)

const lastEventOf = (events: readonly V2Event[]): V2Event | undefined => events[events.length - 1]

const stopConsumedAfterTurn = (events: readonly V2Event[]): boolean => {
  const turnIndex = events.findLastIndex((event) => !isTurnNeutral(event))
  return events
    .slice(turnIndex + 1)
    .some((event) => event.type === 'input-consumed' && event.consumed === EInputConsumed.Stop)
}

const unfinishedRunFailed = (
  events: readonly V2Event[],
): Extract<V2Event, { type: 'run-failed' }> | undefined => {
  const last = lastEventOf(events)
  if (last?.type === 'run-failed') return last
  const secondLast = events[events.length - 2]
  if (last?.type === 'run-failure-dismissed' && secondLast?.type === 'run-failed') {
    return secondLast
  }
  return undefined
}

const workspaceStatusOf = (args: {
  events: readonly V2Event[]
  messageAfterFailure: boolean
}): SessionStatus | undefined => {
  const { events } = args
  if ((events[0]?.seq ?? 1) > 1 || isWorkspacePrepared(events)) return undefined
  const failure = lastPrepareFailure(events)
  if (failure === undefined || args.messageAfterFailure) {
    return { state: ESessionStatus.Preparing }
  }
  return { state: ESessionStatus.SetupFailed, reason: failure.reason, since: failure.at }
}

export function sessionStatusOf(params: {
  events: readonly V2Event[]
  live: boolean
  unconsumedInbox: boolean
  messageAfterFailure?: boolean | undefined
  now: string
}): SessionStatus {
  const { events, live } = params
  const nowMs = Date.parse(params.now)

  const startFailure = activeStartFailure(events)
  if (startFailure !== undefined) {
    if (params.messageAfterFailure === true) return { state: ESessionStatus.Sent }
    return { state: ESessionStatus.Failed, reason: startFailure.reason, since: startFailure.at }
  }

  const workspace =
    params.messageAfterFailure === undefined
      ? undefined
      : workspaceStatusOf({ events, messageAfterFailure: params.messageAfterFailure })
  if (workspace !== undefined) return workspace

  if (params.unconsumedInbox) {
    return { state: ESessionStatus.Sent }
  }

  const turnEvents = events.filter((event) => !isTurnNeutral(event))
  const failed = unfinishedRunFailed(turnEvents)
  if (failed !== undefined) {
    return { state: ESessionStatus.Failed, reason: failed.failure.message, since: failed.at }
  }

  const last = lastEventOf(turnEvents)
  const turnOpen = last !== undefined && !isTurnEnding(last) && !stopConsumedAfterTurn(events)

  if (turnOpen) {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index] as V2Event
      if (event.type === 'model-wait-cleared') break
      if (event.type !== 'model-waiting') continue
      if (event.waiting.episode.kind === EWaitEpisodeKind.Credential) {
        return {
          state: ESessionStatus.WaitingForCredentials,
          reason: event.waiting.reason ?? undefined,
          since: event.at,
        }
      }
      break
    }

    for (let index = events.length - 1; index >= 0; index -= 1) {
      const notBefore = retryDeadlineAfter({ event: events[index] as V2Event, nowMs })
      if (notBefore === undefined) continue
      return {
        state: ESessionStatus.WaitingToRetry,
        reason: `retrying at ${notBefore}`,
        since: (events[index] as V2Event).at,
      }
    }

    if (last.type === 'tool-dispatched') {
      return { state: ESessionStatus.RunningTool, reason: last.name, since: last.at }
    }
    if (last.type === 'tool-called' || last.type === 'tool-denied') {
      return { state: ESessionStatus.Thinking, since: last.at }
    }

    if (!live) {
      return { state: ESessionStatus.Resuming, since: last.at }
    }
    return { state: ESessionStatus.Thinking, since: last.at }
  }

  return { state: ESessionStatus.Idle, since: last?.at }
}

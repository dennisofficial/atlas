import { EWaitEpisodeKind } from '../model-recovery/waiting'
import type { V2Event } from './event'

export enum ESessionStatus {
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

const RETRY_KEY_PREFIX = 'retry:'

const TURN_ENDING_TYPES: ReadonlySet<V2Event['type']> = new Set([
  'run-failed',
  'run-failure-dismissed',
])

const isTurnEnding = (event: V2Event): boolean =>
  TURN_ENDING_TYPES.has(event.type) ||
  (event.type === 'assistant-said' && event.aborted !== 'handoff')

const lastEventOf = (events: readonly V2Event[]): V2Event | undefined => events[events.length - 1]

const retryDeadlineOf = (params: { event: V2Event; nowMs: number }): string | undefined => {
  const { event, nowMs } = params
  if (event.type !== 'fact-recorded' || !event.key.startsWith(RETRY_KEY_PREFIX)) return undefined
  const value = event.value
  if (typeof value !== 'object' || value === null || !('notBefore' in value)) return undefined
  const notBefore = String(value.notBefore)
  const parsed = Date.parse(notBefore)
  return Number.isFinite(parsed) && parsed > nowMs ? notBefore : undefined
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

export function sessionStatusOf(params: {
  events: readonly V2Event[]
  live: boolean
  unconsumedInbox: boolean
  now: string
}): SessionStatus {
  const { events, live } = params
  const nowMs = Date.parse(params.now)

  if (params.unconsumedInbox) {
    return { state: ESessionStatus.Sent }
  }

  const failed = unfinishedRunFailed(events)
  if (failed !== undefined) {
    return { state: ESessionStatus.Failed, reason: failed.failure.message, since: failed.at }
  }

  const last = lastEventOf(events)
  const turnOpen = last !== undefined && !isTurnEnding(last)

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
      const notBefore = retryDeadlineOf({ event: events[index] as V2Event, nowMs })
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

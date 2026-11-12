import { isTurnTakingType } from '../../agents/kind'
import { CORE_EVENT_TYPES } from '../../events/schema'
import { RECORD_ONLY_TYPES } from '../event'
import { EWaitEpisodeKind } from '../../model-recovery/waiting'
import { EFinishReason } from '../../stream/chunk'
import { EInputConsumed, type V2Event, type V2EventType } from '../event'
import { endsStartFailure } from '../start-failure'
import { countsAsPrepared } from '../workspace'

export type TimedReason = { reason: string; at: string }

export type TurnFact = {
  type: V2EventType
  at: string
  endsTurn: boolean
  toolName: string | null
}

export type RetryFact = { notBefore: string; at: string }

export type StatusFacts = {
  firstSeq: number | null
  prepared: boolean
  prepareFailure: TimedReason | null
  startFailure: TimedReason | null
  turn: TurnFact | null
  stopAfterTurn: boolean
  unfinishedFailure: { message: string; at: string } | null
  credentialWait: { reason: string | null; at: string } | null
  retries: readonly RetryFact[]
}

export const initialStatusFacts: StatusFacts = {
  firstSeq: null,
  prepared: false,
  prepareFailure: null,
  startFailure: null,
  turn: null,
  stopAfterTurn: false,
  unfinishedFailure: null,
  credentialWait: null,
  retries: [],
}

const TURN_ENDING_TYPES: ReadonlySet<V2EventType> = new Set([
  'run-failed',
  'run-failure-dismissed',
  'workspace-prepared',
  'workspace-prepare-failed',
  'session-start-failed',
])

const TURN_NEUTRAL_TYPES: ReadonlySet<V2EventType> = new Set<V2EventType>([
  'branches-observed',
  'pull-request-linked',
  'fact-recorded',
  'retry-scheduled',
  'input-consumed',
  'input-refused',
  'workspace-step',
])

const KNOWN_TYPES: ReadonlySet<string> = new Set([...CORE_EVENT_TYPES, ...RECORD_ONLY_TYPES])

const isTurnNeutral = (event: V2Event): boolean => {
  if (TURN_NEUTRAL_TYPES.has(event.type)) return true
  if (event.type === 'tool-result') return event.error !== undefined || event.interrupted === true
  return !KNOWN_TYPES.has(event.type) && !isTurnTakingType(event.type)
}

const isTurnEnding = (event: V2Event): boolean =>
  TURN_ENDING_TYPES.has(event.type) ||
  (event.type === 'assistant-said' &&
    event.aborted !== 'handoff' &&
    event.finish !== EFinishReason.ToolCalls)

const turnOf = (event: V2Event): TurnFact => ({
  type: event.type,
  at: event.at,
  endsTurn: isTurnEnding(event),
  toolName: event.type === 'tool-dispatched' ? event.name : null,
})

const unfinishedFailureAfter = (args: {
  facts: StatusFacts
  event: V2Event
}): StatusFacts['unfinishedFailure'] => {
  const { facts, event } = args
  if (event.type === 'run-failed') return { message: event.failure.message, at: event.at }
  if (event.type === 'run-failure-dismissed' && facts.turn?.type === 'run-failed') {
    return facts.unfinishedFailure
  }
  return null
}

const withRetry = (retries: readonly RetryFact[], retry: RetryFact): readonly RetryFact[] => {
  const deadline = Date.parse(retry.notBefore)
  return [...retries.filter((kept) => Date.parse(kept.notBefore) > deadline), retry]
}

const stepWorkspace = (facts: StatusFacts, event: V2Event): StatusFacts => {
  const prepared = facts.prepared || countsAsPrepared(event)
  const prepareFailure =
    event.type === 'workspace-prepare-failed'
      ? { reason: event.reason, at: event.at }
      : facts.prepareFailure
  if (event.type === 'session-start-failed') {
    return {
      ...facts,
      prepared,
      prepareFailure,
      startFailure: { reason: event.reason, at: event.at },
    }
  }
  const startFailure = endsStartFailure(event) ? null : facts.startFailure
  return { ...facts, prepared, prepareFailure, startFailure }
}

const stepWaits = (facts: StatusFacts, event: V2Event): StatusFacts => {
  if (event.type === 'model-wait-cleared') return { ...facts, credentialWait: null }
  if (event.type === 'model-waiting') {
    const credential = event.waiting.episode.kind === EWaitEpisodeKind.Credential
    return {
      ...facts,
      credentialWait: credential ? { reason: event.waiting.reason, at: event.at } : null,
    }
  }
  if (event.type === 'retry-scheduled') {
    return {
      ...facts,
      retries: withRetry(facts.retries, { notBefore: event.notBefore, at: event.at }),
    }
  }
  return facts
}

const stepTurn = (facts: StatusFacts, event: V2Event): StatusFacts => {
  if (!isTurnNeutral(event)) {
    return {
      ...facts,
      turn: turnOf(event),
      stopAfterTurn: false,
      unfinishedFailure: unfinishedFailureAfter({ facts, event }),
    }
  }
  if (event.type === 'input-consumed' && event.consumed === EInputConsumed.Stop) {
    return { ...facts, stopAfterTurn: true }
  }
  return facts
}

export const stepStatusFacts = (facts: StatusFacts, event: V2Event): StatusFacts =>
  stepTurn(
    stepWaits(stepWorkspace({ ...facts, firstSeq: facts.firstSeq ?? event.seq }, event), event),
    event,
  )

import { EWaitEpisodeKind } from '../../model-recovery/waiting'
import { ESetupPhase } from '../../workspace/setup-notice'
import type { V2Event, V2EventType } from '../event'
import { endsStartFailure } from '../start-failure'
import type { OpenTurn, TurnEnd } from '../turns'
import { countsAsPrepared, EWorkspaceStep, EWorkspaceStepState } from '../workspace'
import { attemptTagOf } from '../workspace-attempts'
import { NO_BACKGROUND, stepBackground, type BackgroundFacts } from './background-facts'

export type TimedReason = { reason: string; at: string }

export type TurnFact = {
  type: V2EventType
  at: string
  toolName: string | null
}

export type RetryFact = { notBefore: string; at: string }

export type ParkedFact = { name: string; at: string }

export type ParkedFacts = Readonly<Record<string, ParkedFact>>

export type SetupRun = { at: string }

const SETUP_RUN_LIMIT_MS = 30 * 60_000

export const setupRunningOf = (args: { run: SetupRun | null; now: string }): boolean => {
  if (args.run === null) return false
  return Date.parse(args.now) - Date.parse(args.run.at) < SETUP_RUN_LIMIT_MS
}

export type StatusFacts = {
  firstSeq: number | null
  attempt: number
  prepared: boolean
  prepareFailure: TimedReason | null
  startFailure: TimedReason | null
  turn: TurnFact | null
  openTurn: OpenTurn | null
  lastTurnEnd: TurnEnd | null
  unfinishedFailure: { message: string; at: string } | null
  credentialWait: { reason: string | null; at: string } | null
  retries: readonly RetryFact[]
  parked: ParkedFacts
  background: BackgroundFacts
  setupRun: SetupRun | null
}

export const initialStatusFacts: StatusFacts = {
  firstSeq: null,
  attempt: 0,
  prepared: false,
  prepareFailure: null,
  startFailure: null,
  turn: null,
  openTurn: null,
  lastTurnEnd: null,
  unfinishedFailure: null,
  credentialWait: null,
  retries: [],
  parked: {},
  background: NO_BACKGROUND,
  setupRun: null,
}

const LABEL_TYPES: ReadonlySet<V2EventType> = new Set<V2EventType>([
  'tool-dispatched',
  'tool-called',
  'tool-denied',
  'tool-result',
  'assistant-said',
  'user-said',
  'run-failed',
])

const labelOf = (event: V2Event): TurnFact | null => {
  if (!LABEL_TYPES.has(event.type)) return null
  return {
    type: event.type,
    at: event.at,
    toolName: event.type === 'tool-dispatched' ? event.name : null,
  }
}

const unfinishedFailureAfter = (event: V2Event): StatusFacts['unfinishedFailure'] =>
  event.type === 'run-failed' ? { message: event.failure.message, at: event.at } : null

const withRetry = (retries: readonly RetryFact[], retry: RetryFact): readonly RetryFact[] => {
  const deadline = Date.parse(retry.notBefore)
  return [...retries.filter((kept) => Date.parse(kept.notBefore) > deadline), retry]
}

const stepWorkspace = (facts: StatusFacts, event: V2Event): StatusFacts => {
  const prepared = facts.prepared || countsAsPrepared(event)
  if (event.type === 'workspace-attempt-started') {
    return { ...facts, attempt: event.attempt, prepared, prepareFailure: null }
  }
  const currentAttempt = (attemptTagOf(event) ?? facts.attempt) === facts.attempt
  const prepareFailure =
    event.type === 'workspace-prepare-failed' && currentAttempt
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

const withoutParked = (parked: ParkedFacts, callId: string): ParkedFacts =>
  Object.fromEntries(Object.entries(parked).filter(([id]) => id !== callId))

const stepParked = (facts: StatusFacts, event: V2Event): StatusFacts => {
  if (event.type === 'tool-parked') {
    return {
      ...facts,
      parked: { ...facts.parked, [event.callId]: { name: event.name, at: event.at } },
    }
  }
  if (event.type !== 'tool-called' && event.type !== 'tool-result' && event.type !== 'tool-denied')
    return facts
  if (!Object.hasOwn(facts.parked, event.callId)) return facts
  return { ...facts, parked: withoutParked(facts.parked, event.callId) }
}

const stepTurn = (facts: StatusFacts, event: V2Event): StatusFacts => {
  if (event.type === 'turn-started') {
    return { ...facts, openTurn: { turnId: event.turnId, startedAt: event.at } }
  }
  if (event.type === 'turn-ended') {
    return {
      ...facts,
      openTurn: facts.openTurn?.turnId === event.turnId ? null : facts.openTurn,
      lastTurnEnd: { outcome: event.outcome, by: event.by, at: event.at },
    }
  }
  const label = labelOf(event)
  if (label === null) return facts
  return { ...facts, turn: label, unfinishedFailure: unfinishedFailureAfter(event) }
}

const setupRunAfter = (event: V2Event): SetupRun | null | undefined => {
  if (event.type === 'workspace-attempt-started') return null
  if (event.type === 'workspace-step') {
    if (event.step !== EWorkspaceStep.Setup) return undefined
    return event.state === EWorkspaceStepState.Started ? { at: event.at } : null
  }
  if (event.type !== 'sandbox-setup-reported') return undefined
  if (event.phase === ESetupPhase.Started) return { at: event.at }
  if (event.phase === ESetupPhase.Finished) return null
  return undefined
}

const stepSetupRun = (facts: StatusFacts, event: V2Event): StatusFacts => {
  const run = setupRunAfter(event)
  if (run === undefined) return facts
  if (run === null && facts.setupRun === null) return facts
  return { ...facts, setupRun: run }
}

const stepBackgroundFacts = (facts: StatusFacts, event: V2Event): StatusFacts => {
  const background = stepBackground(facts.background, event)
  return background === facts.background ? facts : { ...facts, background }
}

export const stepStatusFacts = (facts: StatusFacts, event: V2Event): StatusFacts =>
  stepSetupRun(
    stepBackgroundFacts(
      stepParked(
        stepTurn(
          stepWaits(
            stepWorkspace({ ...facts, firstSeq: facts.firstSeq ?? event.seq }, event),
            event,
          ),
          event,
        ),
        event,
      ),
      event,
    ),
    event,
  )

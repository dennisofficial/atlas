import {
  attachmentsOf,
  EMessageOrigin,
  ERewindCause,
  saidBy,
  type Attachment,
  type RecordEvent,
} from '@dltech/atlas-core'

export type QuickStopMessage = {
  clientId: string
  text: string
  attachments: readonly Attachment[]
}

export type QuickStopEvidence = {
  rewindEventId: string
  messages: readonly QuickStopMessage[]
}

export type QuickStopCandidate = QuickStopMessage & { seq: number }

export type QuickStopInbox = readonly [inboxId: number, clientId: string]

export type QuickStopState = {
  clientIdByInbox: readonly QuickStopInbox[]
  candidates: readonly QuickStopCandidate[]
  lastTurnEndedSeq: number
  evidence: readonly QuickStopEvidence[]
}

export const QUICK_STOP_EVIDENCE_LIMIT = 20

export const EMPTY_QUICK_STOP_STATE: QuickStopState = {
  clientIdByInbox: [],
  candidates: [],
  lastTurnEndedSeq: 0,
  evidence: [],
}

type SaidRow = Extract<RecordEvent, { type: 'user-said' }>
type RewindRow = Extract<RecordEvent, { type: 'history-rewound' }>

const clientIdIn = (args: {
  clientIdByInbox: readonly QuickStopInbox[]
  inboxId: number | undefined
}): string | undefined => args.clientIdByInbox.find(([inboxId]) => inboxId === args.inboxId)?.[1]

const candidateOf = (args: {
  event: SaidRow
  clientIdByInbox: readonly QuickStopInbox[]
}): QuickStopCandidate | undefined => {
  const { event, clientIdByInbox } = args
  if (saidBy(event) !== EMessageOrigin.Operator) return undefined
  const clientId = event.clientId ?? clientIdIn({ clientIdByInbox, inboxId: event.inboxId })
  if (clientId === undefined) return undefined
  return { seq: event.seq, clientId, text: event.text, attachments: attachmentsOf(event) }
}

const hiddenBy = (args: { candidate: QuickStopCandidate; rewind: RewindRow }): boolean =>
  args.candidate.seq > args.rewind.toSeq && args.candidate.seq < args.rewind.seq

const messageOf = (candidate: QuickStopCandidate): QuickStopMessage => ({
  clientId: candidate.clientId,
  text: candidate.text,
  attachments: candidate.attachments,
})

const withoutInbox = (args: {
  clientIdByInbox: readonly QuickStopInbox[]
  inboxId: number | undefined
}): readonly QuickStopInbox[] =>
  args.clientIdByInbox.filter(([inboxId]) => inboxId !== args.inboxId)

const rewindQuickStop = (state: QuickStopState, rewind: RewindRow): QuickStopState => {
  const hidden = state.candidates.filter((candidate) => hiddenBy({ candidate, rewind }))
  if (hidden.length === 0) return state
  const kept = state.candidates.filter((candidate) => !hiddenBy({ candidate, rewind }))
  const evidence = [
    ...state.evidence,
    { rewindEventId: rewind.id, messages: hidden.map(messageOf) },
  ].slice(-QUICK_STOP_EVIDENCE_LIMIT)
  return { ...state, candidates: kept, evidence }
}

const rewindPlain = (state: QuickStopState, rewind: RewindRow): QuickStopState => {
  const kept = state.candidates.filter((candidate) => candidate.seq <= rewind.toSeq)
  return kept.length === state.candidates.length ? state : { ...state, candidates: kept }
}

export const stepQuickStop = (state: QuickStopState, event: RecordEvent): QuickStopState => {
  if (event.type === 'input-posted') {
    const clientId = event.message?.clientId
    if (clientId === undefined) return state
    return {
      ...state,
      clientIdByInbox: [
        ...state.clientIdByInbox.filter(([inboxId]) => inboxId !== event.inboxId),
        [event.inboxId, clientId] as const,
      ],
    }
  }
  if (event.type === 'turn-ended') return { ...state, lastTurnEndedSeq: event.seq }
  if (event.type === 'turn-started') {
    const kept = state.candidates.filter((candidate) => candidate.seq >= state.lastTurnEndedSeq)
    return kept.length === state.candidates.length ? state : { ...state, candidates: kept }
  }
  if (event.type === 'user-said') {
    const candidate = candidateOf({ event, clientIdByInbox: state.clientIdByInbox })
    if (candidate === undefined) return state
    return {
      ...state,
      clientIdByInbox: withoutInbox({
        clientIdByInbox: state.clientIdByInbox,
        inboxId: event.inboxId,
      }),
      candidates: [...state.candidates, candidate],
    }
  }
  if (event.type === 'history-rewound') {
    return event.cause === ERewindCause.QuickStop
      ? rewindQuickStop(state, event)
      : rewindPlain(state, event)
  }
  return state
}

export const quickStopsOf = (events: readonly RecordEvent[]): readonly QuickStopEvidence[] =>
  events.reduce(stepQuickStop, EMPTY_QUICK_STOP_STATE).evidence

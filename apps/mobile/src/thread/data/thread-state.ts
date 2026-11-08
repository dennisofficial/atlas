import type { StepSignal } from '@dltech/atlas-client/channel'
import {
  deriveTranscript,
  eventsFromWire,
  unreadableWireCount,
  type TranscriptEntry,
} from '@dltech/atlas-client/transcript'
import type { CallId } from '@dltech/atlas-core'
import type { OperatorInputRequestWire, WireEvent } from '@dltech/atlas-wire/web'

import { mergeEvents } from './events'
import { ERowKind, rowsOf, type ThreadRow } from '../rows'

export type ThreadAction =
  | { type: 'seed'; events: readonly WireEvent[]; title: string | null; working: boolean }
  | { type: 'events'; events: readonly WireEvent[] }
  | { type: 'replace'; events: readonly WireEvent[] }
  | { type: 'signal'; signal: StepSignal }
  | { type: 'working'; working: boolean }
  | { type: 'connection'; connection: string }
  | { type: 'operator-input'; request: OperatorInputRequestWire | null }
  | { type: 'rename'; title: string }
  | { type: 'failed' }

export type ThreadState = {
  events: readonly WireEvent[]
  signals: readonly StepSignal[]
  outputs: ReadonlyMap<CallId, string>
  working: boolean
  loaded: boolean
  failed: boolean
  stale: boolean
  title: string | null
  connection: string | null
  operatorInput: OperatorInputRequestWire | null
}

export const INITIAL_THREAD_STATE: ThreadState = {
  events: [],
  signals: [],
  outputs: new Map(),
  working: false,
  loaded: false,
  failed: false,
  stale: false,
  title: null,
  connection: null,
  operatorInput: null,
}

const MAX_SIGNALS = 400
const MAX_OUTPUT = 20_000

const withoutSignals = (state: ThreadState): ThreadState => ({
  ...state,
  signals: [],
  outputs: new Map(),
})

const withSignal = (state: ThreadState, signal: StepSignal): ThreadState => {
  if (signal.type === 'tool-output') {
    const outputs = new Map(state.outputs)
    outputs.set(
      signal.callId,
      ((outputs.get(signal.callId) ?? '') + signal.text).slice(-MAX_OUTPUT),
    )
    return { ...state, outputs }
  }
  if (signal.type === 'turn-working') return { ...state, working: signal.working }
  return { ...state, signals: [...state.signals, signal].slice(-MAX_SIGNALS) }
}

export function threadReducer(state: ThreadState, action: ThreadAction): ThreadState {
  switch (action.type) {
    case 'seed':
      return {
        ...withoutSignals(state),
        events: action.events,
        stale: unreadableWireCount(action.events) > 0,
        loaded: true,
        failed: false,
        title: action.title ?? state.title,
        working: action.working,
      }
    case 'events':
      return {
        ...state,
        events: mergeEvents({ current: state.events, incoming: action.events }),
        stale: state.stale || unreadableWireCount(action.events) > 0,
      }
    case 'replace':
      return {
        ...withoutSignals(state),
        events: action.events,
        stale: unreadableWireCount(action.events) > 0,
      }
    case 'signal':
      return withSignal(state, action.signal)
    case 'working':
      return { ...state, working: action.working }
    case 'connection':
      return { ...state, connection: action.connection }
    case 'operator-input':
      return { ...state, operatorInput: action.request }
    case 'rename':
      return { ...state, title: action.title }
    case 'failed':
      return { ...state, failed: true, loaded: true }
    default:
      return state
  }
}

export type ThreadView = {
  rows: ThreadRow[]
  working: boolean
  streaming: boolean
  failure: string | null
  lastUserRowId: string | null
}

export function viewOf(args: { state: ThreadState; now: number }): ThreadView {
  const model = deriveTranscript({
    events: eventsFromWire(args.state.events),
    signals: args.state.signals,
    outputs: args.state.outputs,
    now: () => new Date(args.now),
  })
  const entries: readonly TranscriptEntry[] = model.entries
  const rows = rowsOf({ entries, working: args.state.working, now: args.now })
  const lastUser = rows.findLast((row) => row.kind === ERowKind.Message && row.author === 'you')
  return {
    rows,
    working: args.state.working,
    streaming: model.streaming,
    failure: model.failure?.message ?? null,
    lastUserRowId: lastUser?.id ?? null,
  }
}

import type { ChannelSignal, StepSignal } from '@dltech/atlas-client/channel'
import { prunedSignals } from '@dltech/atlas-client/transcript'
import type { CallId, Event } from '@dltech/atlas-core'

export const MAX_TAIL_CHARACTERS = 60_000

export type SignalState = { signals: StepSignal[]; outputs: ReadonlyMap<CallId, string> }

export const EMPTY_SIGNALS: SignalState = { signals: [], outputs: new Map() }

const isStepSignal = (signal: ChannelSignal): signal is StepSignal =>
  signal.type === 'turn-working' ||
  signal.type === 'step-started' ||
  signal.type === 'chunk' ||
  signal.type === 'step-ended' ||
  signal.type === 'tool-output'

export function absorbSignal(args: { state: SignalState; signal: ChannelSignal }): SignalState {
  const { state, signal } = args
  if (!isStepSignal(signal) || signal.type === 'turn-working') return state
  if (signal.type !== 'tool-output') {
    return { signals: [...state.signals, signal], outputs: state.outputs }
  }
  const outputs = new Map(state.outputs)
  outputs.set(
    signal.callId,
    ((outputs.get(signal.callId) ?? '') + signal.text).slice(-MAX_TAIL_CHARACTERS),
  )
  return { signals: state.signals, outputs }
}

export function pruneSignals(args: { state: SignalState; events: readonly Event[] }): SignalState {
  const { state, events } = args
  const signals = prunedSignals({ signals: state.signals, events })
  const settled = new Set<CallId>()
  for (const event of events) {
    if (event.type === 'tool-result' || event.type === 'tool-denied') settled.add(event.callId)
  }
  const kept = [...state.outputs].filter(([callId]) => !settled.has(callId))
  const outputs = kept.length === state.outputs.size ? state.outputs : new Map(kept)
  if (signals === state.signals && outputs === state.outputs) return state
  return { signals: [...signals], outputs }
}

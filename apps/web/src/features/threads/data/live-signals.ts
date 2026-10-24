import type { ChannelSignal, StepSignal } from '@dltech/atlas-client/channel'
import type { CallId, Event } from '@dltech/atlas-core'
import type { WireEvent } from '@dltech/atlas-wire/web'

import { eventsFromWire } from './events-from-wire'

export const MAX_TAIL_CHARACTERS = 60_000

export type OutputState = { outputs: ReadonlyMap<CallId, string> }

export const EMPTY_OUTPUTS: OutputState = { outputs: new Map() }

export const isStepSignal = (signal: ChannelSignal): signal is StepSignal =>
  signal.type === 'turn-working' ||
  signal.type === 'step-started' ||
  signal.type === 'chunk' ||
  signal.type === 'step-ended' ||
  signal.type === 'tool-output'

export function absorbOutput(args: { state: OutputState; signal: ChannelSignal }): OutputState {
  const { state, signal } = args
  if (signal.type !== 'tool-output') return state
  const outputs = new Map(state.outputs)
  outputs.set(
    signal.callId,
    ((outputs.get(signal.callId) ?? '') + signal.text).slice(-MAX_TAIL_CHARACTERS),
  )
  return { outputs }
}

export function pruneOutputs(args: { state: OutputState; events: readonly Event[] }): OutputState {
  const { state, events } = args
  const settled = new Set<CallId>()
  for (const event of events) {
    if (event.type === 'tool-result' || event.type === 'tool-denied') settled.add(event.callId)
  }
  const kept = [...state.outputs].filter(([callId]) => !settled.has(callId))
  return kept.length === state.outputs.size ? state : { outputs: new Map(kept) }
}

export type LiveOutputFields = OutputState & { events: WireEvent[] }

export function absorbInto<State extends LiveOutputFields>(args: {
  state: State
  signal: ChannelSignal
}): State {
  const { state, signal } = args
  const absorbed = absorbOutput({ state, signal })
  return absorbed === state ? state : { ...state, outputs: absorbed.outputs }
}

export function settleInto<State extends LiveOutputFields>(state: State): State {
  if (state.outputs.size === 0) return state
  const pruned = pruneOutputs({ state, events: eventsFromWire(state.events) })
  return pruned === state ? state : { ...state, outputs: pruned.outputs }
}

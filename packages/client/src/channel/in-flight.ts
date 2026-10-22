import type { CallId } from '@dltech/atlas-core'

import type { StepSignal } from './signal'

export const REPLAYABLE_TOOL_OUTPUT_CHARACTERS = 60_000

export type InFlightSlots = Map<CallId, number>

const tailOf = (text: string): string => text.slice(-REPLAYABLE_TOOL_OUTPUT_CHARACTERS)

export function retainReplayable(args: {
  inFlight: StepSignal[]
  slots: InFlightSlots
  signal: StepSignal
}): void {
  const { inFlight, slots, signal } = args
  if (signal.type !== 'tool-output') {
    inFlight.push(signal)
    return
  }
  const slot = slots.get(signal.callId)
  if (slot !== undefined) {
    const held = inFlight[slot]
    if (held?.type === 'tool-output' && held.callId === signal.callId) {
      inFlight[slot] = { ...signal, text: tailOf(held.text + signal.text) }
      return
    }
  }
  slots.set(signal.callId, inFlight.length)
  inFlight.push(
    signal.text.length > REPLAYABLE_TOOL_OUTPUT_CHARACTERS
      ? { ...signal, text: tailOf(signal.text) }
      : signal,
  )
}

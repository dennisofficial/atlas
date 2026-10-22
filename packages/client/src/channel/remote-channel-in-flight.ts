import { retainReplayable, type InFlightSlots } from './in-flight'
import type { ChannelSignal, StepId, StepSignal } from './signal'

export const NOTHING_IN_FLIGHT: readonly StepSignal[] = Object.freeze([])

const WORKING_SIGNAL: StepSignal = Object.freeze({ type: 'turn-working', working: true })

type OperatorInputSignal = Extract<ChannelSignal, { type: 'operator-input' }>

export type InFlightReplay = {
  absorb(signal: ChannelSignal): void
  replay(): readonly ChannelSignal[]
  stepId(): StepId | undefined
  working(): boolean
  forget(): void
}

export function createInFlightReplay(): InFlightReplay {
  let inFlight: StepSignal[] = []
  const slots: InFlightSlots = new Map()
  let replay: readonly ChannelSignal[] | undefined
  let operatorInput: OperatorInputSignal | null = null
  let stepId: StepId | undefined
  let working = false

  const startStep = (next: StepId | undefined, held: StepSignal[]) => {
    stepId = next
    inFlight = held
    slots.clear()
  }

  const absorb = (signal: ChannelSignal) => {
    if (signal.type === 'pending-changed') return
    if (signal.type === 'operator-input') {
      replay = undefined
      operatorInput = signal.request === null ? null : signal
      return
    }
    if (signal.type === 'turn-working') {
      replay = undefined
      working = signal.working
      return
    }
    if (signal.type === 'step-started') {
      replay = undefined
      startStep(signal.stepId, [signal])
      return
    }
    if (signal.type === 'step-ended') {
      replay = undefined
      startStep(undefined, [])
      return
    }
    if (signal.type !== 'chunk' && signal.type !== 'tool-output') return
    if (signal.type === 'chunk' && signal.stepId !== stepId) startStep(signal.stepId, [])
    retainReplayable({ inFlight, slots, signal })
    replay = undefined
  }

  return {
    absorb,
    replay() {
      if (replay !== undefined) return replay
      if (!working && inFlight.length === 0 && operatorInput === null) return NOTHING_IN_FLIGHT
      const held: ChannelSignal[] = working ? [WORKING_SIGNAL, ...inFlight] : [...inFlight]
      if (operatorInput !== null) held.push(operatorInput)
      replay = Object.freeze(held)
      return replay
    },
    stepId: () => stepId,
    working: () => working,
    forget() {
      startStep(undefined, [])
      working = false
      replay = undefined
    },
  }
}

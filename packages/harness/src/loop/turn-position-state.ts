import type { Assembled, CallId, ModelToolCall } from '@dltech/atlas-core'

import type { WatchState } from './loop-watchdog'

export type TurnPosition = {
  previous: Assembled | undefined
  modelSteps: number
  seenThrough: number | undefined
  settleAttempted: CallId | undefined
  compacted: boolean
  silentSteps: number
  silentRetries: number
  loopCuts: number
  watch: WatchState
  committedCalls: ModelToolCall[]
  resetAssembly: () => void
}

export function openPosition(): TurnPosition {
  const position: TurnPosition = {
    previous: undefined,
    modelSteps: 0,
    seenThrough: undefined,
    settleAttempted: undefined,
    compacted: false,
    silentSteps: 0,
    silentRetries: 0,
    loopCuts: 0,
    watch: { warned: false, cutAnchors: [] },
    committedCalls: [],
    resetAssembly: () => {
      position.previous = undefined
      position.seenThrough = undefined
    },
  }
  return position
}

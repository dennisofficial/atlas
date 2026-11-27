import type { ReturnOutcome } from '@dltech/atlas-core'

export type ReturnStore = {
  read: (state: string | undefined) => ReturnOutcome | undefined
  remember: (args: { state: string; outcome: ReturnOutcome }) => void
  subscribe: (listener: () => void) => () => void
}

export const createReturnStore = (): ReturnStore => {
  const outcomes = new Map<string, ReturnOutcome>()
  const listeners = new Set<() => void>()

  return {
    read: (state) => (state === undefined ? undefined : outcomes.get(state)),
    remember: ({ state, outcome }) => {
      outcomes.set(state, outcome)
      for (const listener of listeners) listener()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

export const browserReturns = createReturnStore()

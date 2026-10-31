import type { CallId, Event } from '@dltech/atlas-core'

const MAX_TAIL_CHARACTERS = 60_000

export type OutputTails = {
  readonly map: ReadonlyMap<CallId, string>
  append(args: { callId: CallId; text: string }): void
  prune(events: readonly Event[]): void
  clear(): void
}

export function createOutputTails(): OutputTails {
  const tails = new Map<CallId, string>()

  return {
    map: tails,

    append({ callId, text }) {
      tails.set(callId, ((tails.get(callId) ?? '') + text).slice(-MAX_TAIL_CHARACTERS))
    },

    prune(events) {
      if (tails.size === 0) return

      const called = new Set<CallId>()
      const settledIds = new Set<CallId>()
      for (const event of events) {
        if (event.type === 'tool-called') called.add(event.callId)
        if (event.type === 'tool-result' || event.type === 'tool-denied') {
          settledIds.add(event.callId)
        }
      }

      for (const callId of [...tails.keys()]) {
        if (settledIds.has(callId) || !called.has(callId)) tails.delete(callId)
      }
    },

    clear() {
      tails.clear()
    },
  }
}

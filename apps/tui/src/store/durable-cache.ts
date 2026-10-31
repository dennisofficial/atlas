import type { Event } from '@dltech/atlas-core'
import type { TurnSpend } from '@dltech/atlas-harness'
import { durableEntries, type TranscriptEntry } from '@dltech/atlas-client/transcript'

export function createDurableCache(): (args: {
  events: readonly Event[]
  turns: readonly TurnSpend[]
}) => readonly TranscriptEntry[] {
  let cached: {
    events: readonly Event[]
    turns: readonly TurnSpend[]
    entries: TranscriptEntry[]
  } | null = null

  return ({ events, turns }) => {
    if (cached !== null && cached.events === events && cached.turns === turns) {
      return cached.entries
    }

    const entries = durableEntries({ events, turns })
    cached = { events, turns, entries }
    return entries
  }
}

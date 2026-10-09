import { EPrEventKind } from '@dltech/atlas-core'

const SEEN_IDS_LIMIT = 200

export type PrEventCandidate = {
  id: string
  repo: string
  prNumber: number
  kind: EPrEventKind
  verdict?: string | undefined
  mergeable?: boolean | undefined
  state?: string | undefined
}

export type PrEventDedupe = {
  admit: (candidate: PrEventCandidate) => boolean
}

const TRANSITION_KINDS: ReadonlySet<EPrEventKind> = new Set([
  EPrEventKind.Verdict,
  EPrEventKind.Mergeability,
  EPrEventKind.State,
])

const readingOf = (candidate: PrEventCandidate): string => {
  if (candidate.kind === EPrEventKind.Verdict) return candidate.verdict ?? ''
  if (candidate.kind === EPrEventKind.Mergeability) return String(candidate.mergeable)
  return candidate.state ?? ''
}

/**
 * Every kind dedupes by frame id, because the API replays undelivered mailbox rows on each
 * reconnect. Transition kinds additionally compare against the last reading admitted for that
 * pull request, so a replayed `green` that lands after a newer `failed` cannot resurface.
 */
export function createPrEventDedupe(): PrEventDedupe {
  const seen = new Set<string>()
  const lastReading = new Map<string, string>()

  const remember = (id: string): void => {
    seen.add(id)
    if (seen.size <= SEEN_IDS_LIMIT) return
    const oldest = seen.values().next().value
    if (oldest !== undefined) seen.delete(oldest)
  }

  return {
    admit: (candidate) => {
      if (seen.has(candidate.id)) return false
      remember(candidate.id)
      if (!TRANSITION_KINDS.has(candidate.kind)) return true

      const slot = `${candidate.repo}#${candidate.prNumber}:${candidate.kind}`
      const reading = readingOf(candidate)
      if (lastReading.get(slot) === reading) return false

      lastReading.set(slot, reading)
      return true
    },
  }
}

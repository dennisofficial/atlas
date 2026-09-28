import {
  EChecksState,
  EPullRequestLookup,
  EPullRequestState,
  type ChecksTally,
  type PullRequest,
  type PullRequestReading,
} from '../plugins/github/pure'
import type { SubscriptionHandle, SubscriptionPrState } from './pr-subscription-client'

export type SubscriptionBy =
  | { kind: 'branch'; branch: string }
  | { kind: 'number'; number: number }

export type BookEntry = {
  key: string
  handle: SubscriptionHandle
  by: SubscriptionBy
  reading: PullRequestReading
}

const PULL_REQUEST_STATES: Record<string, EPullRequestState> = {
  open: EPullRequestState.Open,
  draft: EPullRequestState.Draft,
  merged: EPullRequestState.Merged,
  closed: EPullRequestState.Closed,
}

const checksOf = (tally: ChecksTally): EChecksState => {
  if (tally.failed > 0) return EChecksState.Failing
  if (tally.running > 0) return EChecksState.Running
  if (tally.passed > 0) return EChecksState.Passing
  return EChecksState.None
}

export const readingOfState = (state: SubscriptionPrState): PullRequestReading => {
  const pullState = PULL_REQUEST_STATES[state.state]
  if (pullState === undefined) return { lookup: EPullRequestLookup.Unavailable, retryable: true }

  const pullRequest: PullRequest = {
    number: state.number,
    title: state.title,
    url: state.url,
    state: pullState,
    checks: checksOf(state.checks),
    tally: state.checks,
  }
  return { lookup: EPullRequestLookup.Found, pullRequest }
}

const prIdentityOf = (state: SubscriptionPrState): string =>
  `github.com/${state.repoFullName}#${state.number}`

const ABSENT: PullRequestReading = { lookup: EPullRequestLookup.Absent }

export type SseSubscriptionBook = {
  holding: (args: { key: string }) => BookEntry | null
  entries: () => readonly BookEntry[]
  handles: () => readonly SubscriptionHandle[]
  size: () => number
  recordSubscribe: (args: {
    key: string
    handle: SubscriptionHandle
    by: SubscriptionBy
    state: SubscriptionPrState | null
  }) => PullRequestReading
  recordResubscribe: (args: {
    key: string
    handle: SubscriptionHandle
    state: SubscriptionPrState | null
  }) => void
  applyFrame: (args: { data: string }) => void
  markAllStale: () => void
  markAllDead: () => void
  clear: () => void
}

/**
 * The subscription ledger behind the port: which keys are subscribed, under which handle, and
 * the last reading each produced. Emits through `onReading` only when a key's shown answer
 * actually changes, so a check_run storm cannot redraw the tile per frame. `byIdentity` routes
 * a pushed frame (which carries repo+number) back to the checkout- or link-keyed entry that
 * subscribed it.
 */
export function createSseSubscriptionBook(args: {
  now: () => number
  onReading: (readingArgs: { key: string; reading: PullRequestReading }) => void
}): SseSubscriptionBook {
  const entries = new Map<string, BookEntry>()
  const byIdentity = new Map<string, string>()

  const emit = (key: string, reading: PullRequestReading): void => {
    const held = entries.get(key)
    if (held !== undefined && sameShown(held.reading, reading)) return

    if (held !== undefined) entries.set(key, { ...held, reading })
    args.onReading({ key, reading })
  }

  const index = (state: SubscriptionPrState, key: string): void => {
    byIdentity.set(prIdentityOf(state), key)
  }

  return {
    holding: ({ key }) => entries.get(key) ?? null,
    entries: () => [...entries.values()],
    handles: () => [...entries.values()].map((entry) => entry.handle),
    size: () => entries.size,
    recordSubscribe: ({ key, handle, by, state }) => {
      const reading = state === null ? ABSENT : readingOfState(state)
      entries.set(key, { key, handle, by, reading })
      if (state !== null) index(state, key)
      args.onReading({ key, reading })
      return reading
    },
    recordResubscribe: ({ key, handle, state }) => {
      const held = entries.get(key)
      if (held === undefined) return

      entries.set(key, { ...held, handle })
      if (state !== null) {
        index(state, key)
        emit(key, readingOfState(state))
      }
    },
    applyFrame: ({ data }) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(data)
      } catch {
        return
      }
      const state = parsed as SubscriptionPrState
      if (typeof state.repoFullName !== 'string' || typeof state.number !== 'number') return

      const key = byIdentity.get(prIdentityOf(state))
      if (key === undefined) return

      emit(key, readingOfState(state))
    },
    markAllStale: () => {
      for (const key of entries.keys()) {
        emit(key, { lookup: EPullRequestLookup.Unavailable, retryable: true })
      }
    },
    markAllDead: () => {
      for (const key of entries.keys()) {
        emit(key, { lookup: EPullRequestLookup.Unavailable, retryable: false })
      }
    },
    clear: () => {
      entries.clear()
      byIdentity.clear()
    },
  }
}

const sameShown = (left: PullRequestReading, right: PullRequestReading): boolean => {
  if (left.lookup !== EPullRequestLookup.Found || right.lookup !== EPullRequestLookup.Found) {
    if (left.lookup !== right.lookup) return false
    if (left.lookup === EPullRequestLookup.Unavailable && right.lookup === EPullRequestLookup.Unavailable) {
      return left.retryable === right.retryable
    }
    return true
  }
  return (
    left.pullRequest.number === right.pullRequest.number &&
    left.pullRequest.state === right.pullRequest.state &&
    left.pullRequest.checks === right.pullRequest.checks &&
    left.pullRequest.tally.running === right.pullRequest.tally.running &&
    left.pullRequest.tally.passed === right.pullRequest.tally.passed &&
    left.pullRequest.tally.failed === right.pullRequest.tally.failed
  )
}

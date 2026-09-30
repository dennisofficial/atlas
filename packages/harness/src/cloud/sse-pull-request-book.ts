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

  const tally: ChecksTally = {
    running: state.checksRunning,
    passed: state.checksPassed,
    failed: state.checksFailed,
  }
  const pullRequest: PullRequest = {
    number: state.prNumber,
    title: state.title,
    url: state.url,
    state: pullState,
    checks: checksOf(tally),
    tally,
  }
  return { lookup: EPullRequestLookup.Found, pullRequest }
}

const prIdentityOf = (args: { repoFullName: string; prNumber: number }): string =>
  `github.com/${args.repoFullName}#${args.prNumber}`

const branchIdentityOf = (args: { repoFullName: string; branch: string }): string =>
  `github.com/${args.repoFullName}:${args.branch}`

const ABSENT: PullRequestReading = { lookup: EPullRequestLookup.Absent }

const SETTLED: readonly EPullRequestState[] = [EPullRequestState.Merged, EPullRequestState.Closed]

const adoptsBranchFrame = (args: { reading: PullRequestReading; prNumber: number }): boolean => {
  if (args.reading.lookup === EPullRequestLookup.Absent) return true
  if (args.reading.lookup !== EPullRequestLookup.Found) return false
  return (
    args.reading.pullRequest.number !== args.prNumber &&
    SETTLED.includes(args.reading.pullRequest.state)
  )
}

export type SseSubscriptionBook = {
  holding: (args: { key: string }) => BookEntry | null
  entries: () => readonly BookEntry[]
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
  clear: () => void
}

export function createSseSubscriptionBook(args: {
  now: () => number
  onReading: (readingArgs: { key: string; reading: PullRequestReading }) => void
}): SseSubscriptionBook {
  const entries = new Map<string, BookEntry>()
  const byIdentity = new Map<string, Set<string>>()
  const byBranch = new Map<string, Set<string>>()

  const emit = (key: string, reading: PullRequestReading): void => {
    const held = entries.get(key)
    if (held !== undefined && sameShown(held.reading, reading)) return

    if (held !== undefined) entries.set(key, { ...held, reading })
    args.onReading({ key, reading })
  }

  const addRoute = (route: { index: Map<string, Set<string>>; identity: string; key: string }): void => {
    const keys = route.index.get(route.identity) ?? new Set<string>()
    keys.add(route.key)
    route.index.set(route.identity, keys)
  }

  const removeNumberRoutes = (key: string): void => {
    for (const [identity, keys] of byIdentity) {
      keys.delete(key)
      if (keys.size === 0) byIdentity.delete(identity)
    }
  }

  const index = (state: SubscriptionPrState, key: string): void => {
    addRoute({ index: byIdentity, identity: prIdentityOf(state), key })
  }

  const indexBranch = (key: string): void => {
    const entry = entries.get(key)
    if (entry === undefined || entry.by.kind !== 'branch') return
    addRoute({
      index: byBranch,
      identity: branchIdentityOf({ repoFullName: entry.handle.repoFullName, branch: entry.by.branch }),
      key,
    })
  }

  return {
    holding: ({ key }) => entries.get(key) ?? null,
    entries: () => [...entries.values()],
    size: () => entries.size,
    recordSubscribe: ({ key, handle, by, state }) => {
      const reading = state === null ? ABSENT : readingOfState(state)
      entries.set(key, { key, handle, by, reading })
      indexBranch(key)
      removeNumberRoutes(key)
      if (state !== null) index(state, key)
      args.onReading({ key, reading })
      return reading
    },
    recordResubscribe: ({ key, handle, state }) => {
      const held = entries.get(key)
      if (held === undefined) return

      entries.set(key, { ...held, handle })
      indexBranch(key)
      if (state === null) {
        if (held.reading.lookup === EPullRequestLookup.Found) return
        removeNumberRoutes(key)
        emit(key, ABSENT)
        return
      }
      removeNumberRoutes(key)
      index(state, key)
      emit(key, readingOfState(state))
    },
    applyFrame: ({ data }) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(data)
      } catch {
        return
      }
      const state = parsed as SubscriptionPrState
      if (typeof state.repoFullName !== 'string' || typeof state.prNumber !== 'number') return

      const known = byIdentity.get(prIdentityOf(state))
      for (const key of known ?? []) emit(key, readingOfState(state))

      if (typeof state.headBranch !== 'string') return
      const discovered = byBranch.get(branchIdentityOf({ repoFullName: state.repoFullName, branch: state.headBranch }))
      for (const key of discovered ?? []) {
        const entry = entries.get(key)
        if (entry === undefined) continue
        if (!adoptsBranchFrame({ reading: entry.reading, prNumber: state.prNumber })) continue
        removeNumberRoutes(key)
        index(state, key)
        emit(key, readingOfState(state))
      }
    },
    markAllStale: () => {
      for (const key of entries.keys()) {
        emit(key, { lookup: EPullRequestLookup.Unavailable, retryable: true })
      }
    },
    clear: () => {
      entries.clear()
      byIdentity.clear()
      byBranch.clear()
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

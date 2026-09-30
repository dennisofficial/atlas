import { describe, expect, it } from 'bun:test'

import { pullRequestEntries } from '../../plugins/github/pull-request-entries'
import { createPullRequestService } from '../../plugins/github/pull-request-service'
import {
  checkoutKey,
  EForge,
  EPullRequestLookup,
  EPullRequestState,
  PullRequestPort,
  type RepositoryCheckout,
} from '../../plugins/github/pure'
import type { SubscriptionPrState } from '../pr-subscription-client'
import { createSseSubscriptionBook, type SseSubscriptionBook } from '../sse-pull-request-book'

const CHECKOUT: RepositoryCheckout = {
  directory: '/repo',
  branch: 'feature',
  forge: EForge.GitHub,
  remote: { host: 'github.com', owner: 'owner', repo: 'repo' },
}
const LINK = {
  repo: 'github.com/owner/repo',
  number: 901,
  branch: 'feature',
  url: 'https://github.com/owner/repo/pull/901',
}
const BRANCH_KEY = checkoutKey(CHECKOUT)
const LINK_KEY = `${LINK.repo}#${LINK.number}`

const state = (overrides: Partial<SubscriptionPrState> = {}): SubscriptionPrState => ({
  repoFullName: 'owner/repo',
  prNumber: LINK.number,
  title: 'realtime',
  url: LINK.url,
  state: 'draft',
  headBranch: 'feature',
  headSha: 'abc',
  checksRunning: 7,
  checksPassed: 1,
  checksFailed: 0,
  mergeable: null,
  updatedAt: '2026-09-30T02:00:00Z',
  ...overrides,
})

const subscribe = ({ book, key }: { book: SseSubscriptionBook; key: string }): void => {
  book.recordSubscribe({
    key,
    handle: { id: key, repoFullName: 'owner/repo' },
    by: key === BRANCH_KEY ? { kind: 'branch', branch: 'feature' } : { kind: 'number', number: LINK.number },
    state: state(),
  })
}

class PushPort extends PullRequestPort {
  readonly pushes = true
  async read() { return { lookup: EPullRequestLookup.Absent } as const }
  async readLinked() { return { lookup: EPullRequestLookup.Absent } as const }
}

describe('SSE routing for checkout and linked aliases', () => {
  it.each([
    [BRANCH_KEY, LINK_KEY],
    [LINK_KEY, BRANCH_KEY],
  ])('updates both aliases and the displayed row when subscribing %s first', (first, second) => {
    const service = createPullRequestService({ pullRequests: new PushPort() })
    const book = createSseSubscriptionBook({ now: () => 0, onReading: service.ingest })
    try {
      subscribe({ book, key: first })
      subscribe({ book, key: second })
      book.applyFrame({ data: JSON.stringify(state({ checksRunning: 1, checksPassed: 7, checksFailed: 1 })) })

      const branch = service.snapshot({ key: BRANCH_KEY })
      const linked = service.snapshot({ key: LINK_KEY })
      expect(branch).toEqual(linked)
      if (branch.lookup !== EPullRequestLookup.Found) throw new Error('expected found')
      expect(branch.pullRequest.tally).toEqual({ running: 1, passed: 7, failed: 1 })
      const rows = pullRequestEntries({
        linked: [LINK],
        read: (key) => service.snapshot({ key }),
        current: { checkout: CHECKOUT, reading: branch },
      })
      expect(rows).toHaveLength(1)
      expect(rows[0]?.reading).toEqual(branch)

      book.applyFrame({ data: JSON.stringify(state({ state: 'merged', checksRunning: 0, checksPassed: 9 })) })
      const merged = service.snapshot({ key: BRANCH_KEY })
      if (merged.lookup !== EPullRequestLookup.Found) throw new Error('expected found')
      expect(merged.pullRequest.state).toBe(EPullRequestState.Merged)
      expect(service.snapshot({ key: LINK_KEY })).toEqual(merged)
    } finally {
      service.dispose()
    }
  })

  it('rebinding a stale branch preserves the linked alias routing and removes its old branch route', () => {
    const book = createSseSubscriptionBook({ now: () => 0, onReading: () => {} })
    subscribe({ book, key: BRANCH_KEY })
    subscribe({ book, key: LINK_KEY })
    book.markAllStale()
    book.recordResubscribe({
      key: BRANCH_KEY,
      handle: { id: 'branch', repoFullName: 'owner/repo' },
      state: state({ prNumber: 902, url: 'https://github.com/owner/repo/pull/902' }),
    })
    book.applyFrame({ data: JSON.stringify(state({ state: 'merged' })) })
    const branch = book.holding({ key: BRANCH_KEY })?.reading
    const linked = book.holding({ key: LINK_KEY })?.reading
    if (branch?.lookup !== EPullRequestLookup.Found || linked?.lookup !== EPullRequestLookup.Found) {
      throw new Error('expected both aliases found')
    }
    expect(branch.pullRequest.number).toBe(902)
    expect(branch.pullRequest.state).toBe(EPullRequestState.Draft)
    expect(linked.pullRequest.state).toBe(EPullRequestState.Merged)
  })

  it('a null catch-up from an older API preserves a still-found terminal state', () => {
    const book = createSseSubscriptionBook({ now: () => 0, onReading: () => {} })
    subscribe({ book, key: BRANCH_KEY })
    book.applyFrame({ data: JSON.stringify(state({ state: 'merged' })) })
    const prior = book.holding({ key: BRANCH_KEY })?.reading
    book.recordResubscribe({
      key: BRANCH_KEY,
      handle: { id: 'branch', repoFullName: 'owner/repo' },
      state: null,
    })
    expect(book.holding({ key: BRANCH_KEY })?.reading).toEqual(prior)
  })

  it('a null catch-up restores branch discovery instead of leaving a stale Unavailable entry', () => {
    const book = createSseSubscriptionBook({ now: () => 0, onReading: () => {} })
    subscribe({ book, key: BRANCH_KEY })
    book.markAllStale()
    book.recordResubscribe({
      key: BRANCH_KEY,
      handle: { id: 'branch', repoFullName: 'owner/repo' },
      state: null,
    })
    expect(book.holding({ key: BRANCH_KEY })?.reading.lookup).toBe(EPullRequestLookup.Absent)
    book.applyFrame({ data: JSON.stringify(state({ prNumber: 902 })) })
    const discovered = book.holding({ key: BRANCH_KEY })?.reading
    if (discovered?.lookup !== EPullRequestLookup.Found) throw new Error('expected found')
    expect(discovered.pullRequest.number).toBe(902)
  })
})

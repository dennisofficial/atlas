import { describe, expect, it } from 'bun:test'
import { EPrEventKind, toThreadId, type LinkedPullRequest, type ThreadId } from '@dltech/atlas-core'

import { prEventFrameSchema, type PrEventFrame } from '../../../cloud/pr-event-frame'
import { createFamilyTracker } from '../family-tracker'
import { PrEventNoticeQueue } from '../pr-event-queue'
import { createPrEventRouting } from '../pr-event-routing'
import {
  checkoutKey,
  EChecksState,
  EForge,
  EPullRequestLookup,
  EPullRequestState,
  NO_CHECKS,
  type PullRequestReading,
  type RepositoryCheckout,
} from '../pure'
import type { PullRequestService } from '../pull-request-service'

const MAIN = toThreadId('main')
const OTHER = toThreadId('other')
const TEAMMATE = toThreadId('teammate')

const CHECKOUT: RepositoryCheckout = {
  directory: '/repo',
  branch: 'feature',
  forge: EForge.GitHub,
  remote: { host: 'github.com', owner: 'owner', repo: 'repo' },
}

const found = (number: number): PullRequestReading => ({
  lookup: EPullRequestLookup.Found,
  pullRequest: {
    number,
    title: 't',
    url: `https://github.com/owner/repo/pull/${number}`,
    state: EPullRequestState.Open,
    checks: EChecksState.Passing,
    tally: NO_CHECKS,
    mergeable: null,
    comments: [],
    reviews: [],
  },
})

const frame = (over: Record<string, unknown> = {}): PrEventFrame =>
  prEventFrameSchema.parse({
    id: 'evt_1',
    repoFullName: 'owner/repo',
    prNumber: 42,
    kind: 'comment',
    payload: { url: 'https://github.com/owner/repo/pull/42#c', authorLogin: 'octocat', body: 'hi' },
    createdAt: '2026-10-08T00:00:00Z',
    ...over,
  })

const setup = (
  args: {
    tracked?: PullRequestReading | null
    links?: readonly LinkedPullRequest[]
    extra?: readonly { checkout: RepositoryCheckout; reading: PullRequestReading }[]
    places?: readonly { threadId: ThreadId; checkout: RepositoryCheckout }[]
  } = {},
) => {
  const queue = new PrEventNoticeQueue()
  const tracked = args.tracked === undefined ? found(42) : args.tracked
  const held = [
    ...(tracked === null ? [] : [{ checkout: CHECKOUT, reading: tracked }]),
    ...(args.extra ?? []),
  ]
  const service = {
    track: () => undefined,
    tracked: () => held.map((entry) => entry.checkout),
    snapshot: ({ key }: { key: string }) =>
      held.find((entry) => checkoutKey(entry.checkout) === key)?.reading ?? {
        lookup: EPullRequestLookup.Unavailable,
        retryable: true,
      },
  } as unknown as PullRequestService
  const tracker = createFamilyTracker({ service })
  for (const place of args.places ?? []) tracker.place(place)
  const routing = createPrEventRouting({ service, tracker, links: () => args.links ?? [], queue })
  return { queue, routing }
}

const LINK: LinkedPullRequest = {
  repo: 'github.com/owner/repo',
  number: 77,
  branch: 'other',
  url: 'https://github.com/owner/repo/pull/77',
  linkedBy: undefined,
}

const MAIN_ON_CHECKOUT = { threadId: MAIN, checkout: CHECKOUT }

describe('createPrEventRouting', () => {
  it('queues a frame for the tracked checkout’s pull request on the main thread', async () => {
    const { queue, routing } = setup({ places: [MAIN_ON_CHECKOUT] })
    await routing.threadOpened({ threadId: MAIN, projectDirectory: '/repo' })

    routing.onPrEvent(frame())

    expect(queue.pending({ threadId: MAIN }).map((notice) => notice.draft)).toMatchObject([
      { type: 'pr-event', repo: 'github.com/owner/repo', prNumber: 42, kind: EPrEventKind.Comment },
    ])
  })

  it('queues a frame for a watched linked pull request', async () => {
    const { queue, routing } = setup({ tracked: null, links: [LINK] })
    await routing.threadOpened({ threadId: MAIN, projectDirectory: '/repo' })

    routing.onPrEvent(frame({ prNumber: 77 }))

    expect(queue.threadsAwaiting()).toEqual([MAIN])
  })

  it('ignores frames for pull requests the session neither tracks nor watches', async () => {
    const { queue, routing } = setup({ links: [LINK] })
    await routing.threadOpened({ threadId: MAIN, projectDirectory: '/repo' })

    routing.onPrEvent(frame({ prNumber: 5 }))
    routing.onPrEvent(frame({ id: 'e2', repoFullName: 'owner/elsewhere' }))

    expect(queue.threadsAwaiting()).toEqual([])
  })

  it('does not track on an unfound reading', async () => {
    const { queue, routing } = setup({ tracked: { lookup: EPullRequestLookup.Absent } })
    await routing.threadOpened({ threadId: MAIN, projectDirectory: '/repo' })

    routing.onPrEvent(frame())

    expect(queue.threadsAwaiting()).toEqual([])
  })

  it('emits a repeated verdict once and a flip-flop twice, a repeated comment id once', async () => {
    const { queue, routing } = setup()
    await routing.threadOpened({ threadId: MAIN, projectDirectory: '/repo' })
    const verdict = (id: string, value: string) =>
      frame({ id, kind: 'verdict', payload: { url: 'u', verdict: value } })

    routing.onPrEvent(verdict('a', 'green'))
    routing.onPrEvent(verdict('b', 'green'))
    routing.onPrEvent(verdict('c', 'failed'))
    routing.onPrEvent(verdict('d', 'green'))
    routing.onPrEvent(frame({ id: 'c1' }))
    routing.onPrEvent(frame({ id: 'c1' }))

    expect(queue.pending({ threadId: MAIN })).toHaveLength(4)
  })

  it('holds frames no thread owns until a thread is known, then delivers on the first turn', async () => {
    const { queue, routing } = setup({ tracked: null, links: [LINK] })

    routing.onPrEvent(frame({ prNumber: 77 }))
    expect(queue.threadsAwaiting()).toEqual([])

    await routing.beforeTurn({ threadId: MAIN, projectDirectory: '/repo' })

    expect(queue.threadsAwaiting()).toEqual([MAIN])
  })

  it('keeps the thread it first learned from a turn until a thread is opened', async () => {
    const { queue, routing } = setup()
    await routing.beforeTurn({ threadId: MAIN, projectDirectory: '/repo' })
    await routing.beforeTurn({ threadId: OTHER, projectDirectory: '/repo' })

    routing.onPrEvent(frame())

    expect(queue.threadsAwaiting()).toEqual([MAIN])
  })

  it('moves queued notices to the thread the operator switches to', async () => {
    const { queue, routing } = setup()
    await routing.threadOpened({ threadId: MAIN, projectDirectory: '/repo' })
    routing.onPrEvent(frame())

    await routing.threadOpened({ threadId: OTHER, projectDirectory: '/repo' })
    routing.onPrEvent(frame({ id: 'c2' }))

    expect(queue.threadsAwaiting()).toEqual([OTHER])
    expect(queue.pending({ threadId: OTHER })).toHaveLength(2)
  })

  describe('owner-aware delivery', () => {
    const teammateCheckout = { ...CHECKOUT, directory: '/teammate', branch: 'teammate-branch' }
    const withTeammate = (over: Parameters<typeof setup>[0] = {}) =>
      setup({
        extra: [{ checkout: teammateCheckout, reading: found(55) }],
        places: [MAIN_ON_CHECKOUT, { threadId: TEAMMATE, checkout: teammateCheckout }],
        ...over,
      })

    it('queues a frame for a teammate’s checkout to the teammate, not the main thread', async () => {
      const { queue, routing } = withTeammate()
      await routing.threadOpened({ threadId: MAIN, projectDirectory: '/repo' })

      routing.onPrEvent(frame({ id: 'evt_mate', prNumber: 55 }))

      expect(queue.threadsAwaiting()).toEqual([TEAMMATE])
      expect(queue.pending({ threadId: TEAMMATE }).map((notice) => notice.draft)).toMatchObject([
        { prNumber: 55 },
      ])
    })

    it('still queues a frame for the main thread’s checkout to the main thread', async () => {
      const { queue, routing } = withTeammate()
      await routing.threadOpened({ threadId: MAIN, projectDirectory: '/repo' })

      routing.onPrEvent(frame())

      expect(queue.threadsAwaiting()).toEqual([MAIN])
    })

    it('queues a frame to every thread standing on the checkout once each', async () => {
      const { queue, routing } = setup({
        places: [MAIN_ON_CHECKOUT, { threadId: TEAMMATE, checkout: CHECKOUT }],
      })
      await routing.threadOpened({ threadId: OTHER, projectDirectory: '/repo' })

      routing.onPrEvent(frame())

      expect([...queue.threadsAwaiting()].sort()).toEqual([MAIN, TEAMMATE].sort())
      expect(queue.pending({ threadId: MAIN })).toHaveLength(1)
      expect(queue.pending({ threadId: TEAMMATE })).toHaveLength(1)
    })

    it('queues straight to the owning thread before any thread has been adopted', () => {
      const { queue, routing } = withTeammate()

      routing.onPrEvent(frame({ prNumber: 55 }))

      expect(queue.threadsAwaiting()).toEqual([TEAMMATE])
    })

    it('queues a linked pull request with no live checkout to the thread that linked it', async () => {
      const { queue, routing } = setup({
        tracked: null,
        links: [{ ...LINK, linkedBy: TEAMMATE }],
      })
      await routing.threadOpened({ threadId: MAIN, projectDirectory: '/repo' })

      routing.onPrEvent(frame({ prNumber: 77 }))

      expect(queue.threadsAwaiting()).toEqual([TEAMMATE])
    })

    it('falls back to the visible thread for a linked pull request with no linking thread', async () => {
      const { queue, routing } = setup({ tracked: null, links: [LINK] })
      await routing.threadOpened({ threadId: MAIN, projectDirectory: '/repo' })

      routing.onPrEvent(frame({ prNumber: 77 }))

      expect(queue.threadsAwaiting()).toEqual([MAIN])
    })

    it('prefers the thread standing on the checkout over the thread that linked it', async () => {
      const { queue, routing } = setup({
        places: [MAIN_ON_CHECKOUT],
        links: [{ ...LINK, number: 42, linkedBy: TEAMMATE }],
      })
      await routing.threadOpened({ threadId: OTHER, projectDirectory: '/repo' })

      routing.onPrEvent(frame())

      expect(queue.threadsAwaiting()).toEqual([MAIN])
    })
  })
})

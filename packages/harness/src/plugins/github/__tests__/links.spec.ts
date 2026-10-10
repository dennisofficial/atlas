import { describe, expect, it } from 'bun:test'

import type { Event, ThreadId } from '@dltech/atlas-core'

import { createFamilyTracker } from '../family-tracker'
import { createPullRequestLinks, pullRequestLinkKey } from '../links'
import type { PullRequestService } from '../pull-request-service'
import {
  EChecksState,
  EForge,
  EPullRequestLookup,
  EPullRequestState,
  NO_CHECKS,
  NO_PULL_REQUEST_READING,
  checkoutKey,
  type PullRequestReading,
  type RepositoryCheckout,
} from '../pure'

const CHECKOUT: RepositoryCheckout = {
  directory: '/repo',
  branch: 'dennis/first',
  forge: EForge.GitHub,
  remote: { host: 'github.com', owner: 'dltech', repo: 'atlas' },
}

const foundReading = (number: number): PullRequestReading => ({
  lookup: EPullRequestLookup.Found,
  pullRequest: {
    number,
    title: 'a pull request',
    url: `https://github.com/dltech/atlas/pull/${number}`,
    state: EPullRequestState.Open,
    checks: EChecksState.Passing,
    tally: NO_CHECKS,
    mergeable: null, comments: [], reviews: [],
  },
})

const THREAD_A = 'br_1' as ThreadId
const THREAD_B = 'br_2' as ThreadId

const stub = (readings: ReadonlyMap<string, PullRequestReading>): PullRequestService =>
  ({
    snapshot: ({ key }: { key: string }) => readings.get(key) ?? NO_PULL_REQUEST_READING,
    track: () => undefined,
  }) as unknown as PullRequestService

const standing = (
  current: { checkout: RepositoryCheckout; reading: PullRequestReading } | null,
  threads: readonly ThreadId[] = [THREAD_A, THREAD_B],
) => {
  const service = stub(
    new Map(current === null ? [] : [[checkoutKey(current.checkout), current.reading]]),
  )
  const tracker = createFamilyTracker({ service })
  if (current !== null) {
    for (const threadId of threads) tracker.place({ threadId, checkout: current.checkout })
  }
  return { service, tracker }
}

let nextSeq = 0

const linkEvent = (args: { number: number; branch: string; repo?: string }): Event => {
  nextSeq += 1
  return {
    id: `evt_${nextSeq}`,
    seq: nextSeq,
    threadId: THREAD_A,
    runId: 'run_1',
    depth: 0,
    at: '2026-09-04T12:00:00.000Z',
    type: 'pull-request-linked',
    number: args.number,
    url: `https://github.com/dltech/atlas/pull/${args.number}`,
    repo: args.repo ?? 'github.com/dltech/atlas',
    branch: args.branch,
  } as Event
}

describe('recording a link at turn end', () => {
  it('drafts the pull request the tracked checkout stands on', async () => {
    const links = createPullRequestLinks(standing({ checkout: CHECKOUT, reading: foundReading(401) }))

    const outcome = await links.recordFound({ threadId: THREAD_A })

    expect(outcome.drafts).toEqual([
      {
        type: 'pull-request-linked',
        number: 401,
        url: 'https://github.com/dltech/atlas/pull/401',
        repo: 'github.com/dltech/atlas',
        branch: 'dennis/first',
      },
    ])
  })

  it('drafts nothing when nothing is tracked or found', async () => {
    const untracked = createPullRequestLinks(standing(null))
    expect((await untracked.recordFound({ threadId: THREAD_A })).drafts).toBeUndefined()

    const absent = createPullRequestLinks(
      standing({ checkout: CHECKOUT, reading: { lookup: EPullRequestLookup.Absent } }),
    )
    expect((await absent.recordFound({ threadId: THREAD_A })).drafts).toBeUndefined()
  })

  it('drafts a found pull request only once until the log publishes it', async () => {
    const links = createPullRequestLinks(standing({ checkout: CHECKOUT, reading: foundReading(401) }))

    await links.recordFound({ threadId: THREAD_A })
    const again = await links.recordFound({ threadId: THREAD_A })
    expect(again.drafts).toBeUndefined()

    links.projection.publish({ events: [linkEvent({ number: 401, branch: 'dennis/first' })] })
    const published = await links.recordFound({ threadId: THREAD_A })
    expect(published.drafts).toBeUndefined()
  })

  it('drafts for the thread that ended its turn, from that thread’s own checkout', async () => {
    const mine = { ...CHECKOUT, branch: 'dennis/mine' }
    const theirs = { ...CHECKOUT, branch: 'dennis/theirs' }
    const service = stub(
      new Map([
        [checkoutKey(mine), foundReading(501)],
        [checkoutKey(theirs), foundReading(502)],
      ]),
    )
    const tracker = createFamilyTracker({ service })
    tracker.place({ threadId: THREAD_A, checkout: mine })
    tracker.place({ threadId: THREAD_B, checkout: theirs })
    const links = createPullRequestLinks({ service, tracker })

    const outcome = await links.recordFound({ threadId: THREAD_B })

    expect(outcome.drafts).toEqual([
      expect.objectContaining({ number: 502, branch: 'dennis/theirs' }),
    ])
  })

  it('drafts nothing for a thread that stands on no checkout', async () => {
    const links = createPullRequestLinks(standing({ checkout: CHECKOUT, reading: foundReading(401) }, [THREAD_A]))

    expect((await links.recordFound({ threadId: THREAD_B })).drafts).toBeUndefined()
  })

  it('forgets the session drafts when the thread changes', async () => {
    const links = createPullRequestLinks(standing({ checkout: CHECKOUT, reading: foundReading(401) }))

    await links.recordFound({ threadId: THREAD_A })
    await links.forgetThread({ threadId: THREAD_B, projectDirectory: '/repo' })

    const outcome = await links.recordFound({ threadId: THREAD_B })
    expect(outcome.drafts).toHaveLength(1)
  })
})

describe('reading links back', () => {
  it('folds the published events oldest first', () => {
    const links = createPullRequestLinks(standing(null))

    links.projection.publish({
      events: [
        linkEvent({ number: 401, branch: 'dennis/first' }),
        linkEvent({ number: 412, branch: 'dennis/second' }),
      ],
    })

    expect(links.projection.current().map((link) => link.number)).toEqual([401, 412])
  })

  it('keeps the same reference when a republish changes nothing', () => {
    const links = createPullRequestLinks(standing(null))
    const events = [linkEvent({ number: 401, branch: 'dennis/first' })]

    links.projection.publish({ events })
    const first = links.projection.current()

    let bumped = 0
    links.projection.subscribe(() => {
      bumped += 1
    })
    links.projection.publish({ events: [...events] })

    expect(links.projection.current()).toBe(first)
    expect(bumped).toBe(0)
  })
})

describe('the link key', () => {
  it('is the repository and the number', () => {
    expect(pullRequestLinkKey({ repo: 'github.com/dltech/atlas', number: 401 })).toBe(
      'github.com/dltech/atlas#401',
    )
  })
})

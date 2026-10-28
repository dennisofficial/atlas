import { describe, expect, it } from 'bun:test'

import {
  EPrEventKind,
  EPrReviewState,
  EPrVerdict,
  ESubscriptionActor,
  ESubscriptionStatus,
  toThreadId,
  type Subscription,
} from '@dltech/atlas-core'

import type { PrEventFrame } from '../../../cloud/pr-event-frame'
import { EOccurrenceUrgency, type SubscriptionOccurrence } from '../../../subscriptions/provider'
import { createPullRequestProvider, PULL_REQUEST_PROVIDER_KIND } from '../pull-request-provider'
import { createPullRequestService } from '../pull-request-service'
import type { PullRequestTarget } from '../subscription-target'
import { aCheckout, pullRequestsAnswering, wasFound } from '../testing'

const THREAD = toThreadId('thread-1')
const REPO = 'github.com/dennisofficial/atlas'
const TARGET = { repo: REPO, number: 42 }

let sequence = 0
const frame = (args: {
  kind: EPrEventKind
  prNumber?: number
  id?: string
  payload?: Partial<PrEventFrame['payload']>
}): PrEventFrame => {
  sequence += 1
  return {
    id: args.id ?? `frame-${sequence}`,
    repoFullName: 'dennisofficial/atlas',
    prNumber: args.prNumber ?? 42,
    kind: args.kind,
    payload: { url: 'https://github.com/dennisofficial/atlas/pull/42', ...args.payload },
    createdAt: 't',
  }
}

const subscription = (args?: { id?: string; target?: unknown }): Subscription => ({
  id: args?.id ?? 'sub-1',
  provider: PULL_REQUEST_PROVIDER_KIND,
  target: (args?.target ?? TARGET) as Subscription['target'],
  label: 'dennisofficial/atlas#42',
  threadId: THREAD,
  createdBy: ESubscriptionActor.Agent,
  status: ESubscriptionStatus.Active,
  createdAt: 't',
})

const harness = () => {
  const targets: (readonly PullRequestTarget[])[] = []
  const service = createPullRequestService({ pullRequests: pullRequestsAnswering(wasFound()) })
  const provider = createPullRequestProvider({
    tracker: { checkoutFor: () => null },
    service,
    onTargets: (next) => targets.push(next),
    probe: async () => null,
  })
  const emitted: SubscriptionOccurrence[] = []
  const started = (args?: Parameters<typeof subscription>[0]) =>
    provider.start({ subscription: subscription(args), emit: (o) => emitted.push(o) })

  return { provider, emitted, targets, started, service }
}

describe('the pull request provider', () => {
  it('emits nothing for a pull request nobody subscribed to', () => {
    const { provider, emitted, started } = harness()

    provider.onFrame(frame({ kind: EPrEventKind.Comment }))
    const stop = started({ target: { repo: REPO, number: 7 } })
    provider.onFrame(frame({ kind: EPrEventKind.Comment }))

    expect(emitted).toEqual([])
    stop()
  })

  it('ignores a subscription whose stored target is malformed', () => {
    const { provider, emitted, targets, started } = harness()

    started({ target: { nope: true } })()
    provider.onFrame(frame({ kind: EPrEventKind.Comment }))

    expect(emitted).toEqual([])
    expect(targets).toEqual([])
  })

  describe('occurrence table', () => {
    const cases: {
      name: string
      frame: () => PrEventFrame
      key: string | null
      urgency: EOccurrenceUrgency
      settles?: true
      ends?: true
    }[] = [
      {
        name: 'comment',
        frame: () => frame({ kind: EPrEventKind.Comment, id: 'c1' }),
        key: 'c1',
        urgency: EOccurrenceUrgency.Now,
      },
      {
        name: 'review comment',
        frame: () => frame({ kind: EPrEventKind.ReviewComment, id: 'rc1' }),
        key: 'rc1',
        urgency: EOccurrenceUrgency.Now,
      },
      {
        name: 'changes requested',
        frame: () =>
          frame({
            kind: EPrEventKind.Review,
            id: 'r1',
            payload: { reviewState: EPrReviewState.ChangesRequested },
          }),
        key: 'r1',
        urgency: EOccurrenceUrgency.Now,
      },
      {
        name: 'commented review',
        frame: () =>
          frame({
            kind: EPrEventKind.Review,
            id: 'r2',
            payload: { reviewState: EPrReviewState.Commented },
          }),
        key: 'r2',
        urgency: EOccurrenceUrgency.Now,
      },
      {
        name: 'approval',
        frame: () =>
          frame({
            kind: EPrEventKind.Review,
            payload: { reviewState: EPrReviewState.Approved, authorLogin: 'octocat' },
          }),
        key: 'review:octocat',
        urgency: EOccurrenceUrgency.Batch,
      },
      {
        name: 'failed verdict',
        frame: () => frame({ kind: EPrEventKind.Verdict, payload: { verdict: EPrVerdict.Failed } }),
        key: 'verdict',
        urgency: EOccurrenceUrgency.Now,
      },
      {
        name: 'green verdict',
        frame: () => frame({ kind: EPrEventKind.Verdict, payload: { verdict: EPrVerdict.Green } }),
        key: 'verdict',
        urgency: EOccurrenceUrgency.Batch,
        settles: true,
      },
      {
        name: 'mergeability',
        frame: () => frame({ kind: EPrEventKind.Mergeability, payload: { mergeable: false } }),
        key: 'mergeability',
        urgency: EOccurrenceUrgency.Batch,
      },
      {
        name: 'merged',
        frame: () => frame({ kind: EPrEventKind.State, payload: { state: 'merged' } }),
        key: 'state',
        urgency: EOccurrenceUrgency.Now,
        ends: true,
      },
      {
        name: 'closed',
        frame: () => frame({ kind: EPrEventKind.State, payload: { state: 'closed' } }),
        key: 'state',
        urgency: EOccurrenceUrgency.Now,
        ends: true,
      },
      {
        name: 'a non-terminal state',
        frame: () => frame({ kind: EPrEventKind.State, payload: { state: 'draft' } }),
        key: 'state',
        urgency: EOccurrenceUrgency.Batch,
      },
    ]

    for (const row of cases) {
      it(`maps ${row.name}`, () => {
        const { provider, emitted, started } = harness()
        started()

        provider.onFrame(row.frame())

        expect(emitted).toHaveLength(1)
        const [occurrence] = emitted
        expect(occurrence?.key).toBe(row.key as string)
        expect(occurrence?.urgency).toBe(row.urgency)
        expect(occurrence?.settles).toBe(row.settles)
        expect(occurrence?.ends).toBe(row.ends)
        expect(occurrence?.draft).toMatchObject({ type: 'pr-event', repo: REPO, prNumber: 42 })
      })
    }
  })

  it('drops a poll and SSE duplicate of the same verdict', () => {
    const { provider, emitted, started } = harness()
    started()
    const verdict = { verdict: EPrVerdict.Green, headSha: 'abc' }

    provider.onFrame(frame({ kind: EPrEventKind.Verdict, id: 'sse-1', payload: verdict }))
    provider.onFrame(
      frame({ kind: EPrEventKind.Verdict, id: 'poll:k:verdict:2', payload: verdict }),
    )
    provider.onFrame(frame({ kind: EPrEventKind.Comment, id: 'c', payload: {} }))
    provider.onFrame(frame({ kind: EPrEventKind.Comment, id: 'c', payload: {} }))

    expect(emitted.map((o) => o.key)).toEqual(['verdict', 'c'])
  })

  it('delivers one frame to every subscription on the pull request', () => {
    const { provider, emitted, started } = harness()
    started({ id: 'a' })
    started({ id: 'b' })

    provider.onFrame(frame({ kind: EPrEventKind.Comment }))

    expect(emitted).toHaveLength(2)
  })

  describe('which pull requests are watched', () => {
    it('answers subscribed from the started set', () => {
      const { provider, started } = harness()
      expect(provider.subscribed(TARGET)).toBe(false)

      const stop = started()
      expect(provider.subscribed(TARGET)).toBe(true)
      expect(provider.subscribed({ repo: REPO, number: 7 })).toBe(false)

      stop()
      expect(provider.subscribed(TARGET)).toBe(false)
    })

    it('publishes the extra watch set on start and takes it back on stop', () => {
      const { targets, started } = harness()

      const stop = started()
      expect(targets.at(-1)).toEqual([TARGET])

      stop()
      expect(targets.at(-1)).toEqual([])
    })

    it('keeps watching until the last subscription on a pull request stops', () => {
      const { provider, targets, started } = harness()
      const first = started({ id: 'a' })
      const second = started({ id: 'b' })

      first()
      expect(provider.subscribed(TARGET)).toBe(true)
      expect(targets.at(-1)).toEqual([TARGET])

      second()
      expect(provider.subscribed(TARGET)).toBe(false)
      expect(targets.at(-1)).toEqual([])
    })
  })

  describe('resolving a target', () => {
    it('uses the thread’s tracked checkout and its found pull request', async () => {
      const checkout = aCheckout({ branch: 'dennis/x' })
      const service = createPullRequestService({
        pullRequests: pullRequestsAnswering(wasFound({ number: 9 })),
      })
      service.track({ checkouts: [checkout] })
      await service.refresh({ checkout, force: true })
      await new Promise((resolve) => setTimeout(resolve, 10))
      const provider = createPullRequestProvider({
        tracker: { checkoutFor: () => checkout },
        service,
        onTargets: () => undefined,
        probe: async () => null,
      })

      const resolved = await provider.resolve({
        input: '',
        threadId: THREAD,
        projectDirectory: '/work/atlas',
      })

      expect(resolved).toEqual({
        target: { repo: REPO, number: 9 },
        label: 'dennisofficial/atlas#9',
      })
      service.dispose()
    })

    it('falls back to probing the project directory when the tracker has no place for the thread', async () => {
      const probed: string[] = []
      const service = createPullRequestService({ pullRequests: pullRequestsAnswering(wasFound()) })
      const provider = createPullRequestProvider({
        tracker: { checkoutFor: () => null },
        service,
        onTargets: () => undefined,
        probe: async ({ directory }) => {
          probed.push(directory)
          return aCheckout()
        },
      })

      const resolved = await provider.resolve({
        input: '#5',
        threadId: THREAD,
        projectDirectory: '/work/elsewhere',
      })

      expect(probed).toEqual(['/work/elsewhere'])
      expect(resolved).toEqual({
        target: { repo: REPO, number: 5 },
        label: 'dennisofficial/atlas#5',
      })
      service.dispose()
    })

    it('passes a resolution error through', async () => {
      const { provider } = harness()

      const resolved = await provider.resolve({
        input: '',
        threadId: THREAD,
        projectDirectory: '/nowhere',
      })

      expect('error' in resolved).toBe(true)
    })
  })
})

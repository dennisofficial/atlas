import { describe, expect, it } from 'bun:test'

import { EPrEventKind, EPrReviewState, EPrVerdict } from '@dltech/atlas-core'

import type { PrEventFrame } from '../../../cloud/pr-event-frame'
import { EOccurrenceUrgency } from '../../../subscriptions/provider'
import { frame, harness, REPO } from './provider-fixtures'

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

  it('reaches a subscription through a frame whose repository has other casing', () => {
    const { provider, emitted, started } = harness()
    started({ target: { repo: 'github.com/dltech/atlas', number: 12 } })

    provider.onFrame(
      frame({ kind: EPrEventKind.Comment, prNumber: 12, repoFullName: 'DLTech/Atlas' }),
    )

    expect(emitted).toHaveLength(1)
  })

  it('answers subscribed whatever the casing of the repository asked about', () => {
    const { provider, started } = harness()
    started({ target: { repo: 'github.com/dltech/atlas', number: 12 } })

    expect(provider.subscribed({ repo: 'github.com/DLTech/Atlas', number: 12 })).toBe(true)
  })

  it('reads a stored target written with other casing as the lowercase one', () => {
    const { provider, emitted, started } = harness()
    started({ target: { repo: 'github.com/DLTech/Atlas', number: 12 } })

    provider.onFrame(
      frame({ kind: EPrEventKind.Comment, prNumber: 12, repoFullName: 'dltech/atlas' }),
    )

    expect(emitted).toHaveLength(1)
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
})

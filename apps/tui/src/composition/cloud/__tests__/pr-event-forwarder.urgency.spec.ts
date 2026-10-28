import { describe, expect, it } from 'bun:test'

import { EExecutionLocation, EPrEventKind, EPrReviewState, EPrVerdict } from '@dltech/atlas-core'
import { ECloudSandboxState } from '@dltech/atlas-harness'

import { CLOUD_THREAD, frame, LOCAL_THREAD, rig, summary } from './pr-event-forwarder.fixture'

describe('parked-cloud pr-event forwarding urgency', () => {
  const parkedRig = (repo = 'github.com/owner/repo') =>
    rig({
      summaries: [
        summary({
          id: CLOUD_THREAD,
          location: EExecutionLocation.Cloud,
          subscriptions: [{ repo, number: 42 }],
        }),
      ],
      sandboxState: ECloudSandboxState.Parked,
      activeThreadId: LOCAL_THREAD,
    })

  it.each([
    ['a review comment', { kind: EPrEventKind.ReviewComment }],
    [
      'a changes-requested review',
      { kind: EPrEventKind.Review, reviewState: EPrReviewState.ChangesRequested },
    ],
    ['a commented review', { kind: EPrEventKind.Review, reviewState: EPrReviewState.Commented }],
    ['a failed verdict', { kind: EPrEventKind.Verdict, verdict: EPrVerdict.Failed }],
    ['a merged state', { kind: EPrEventKind.State, state: 'merged' }],
    ['a closed state', { kind: EPrEventKind.State, state: 'closed' }],
  ])('forwards %s as urgent', async (_name, extra) => {
    const { forwarder, sent } = parkedRig()
    const base = frame()

    await forwarder.onPrEvent(frame({ kind: extra.kind, payload: { ...base.payload, ...extra } }))

    expect(sent).toHaveLength(1)
  })

  it.each([
    ['an approval', { kind: EPrEventKind.Review, reviewState: EPrReviewState.Approved }],
    ['a green verdict', { kind: EPrEventKind.Verdict, verdict: EPrVerdict.Green }],
    ['a mergeability change', { kind: EPrEventKind.Mergeability, mergeable: true }],
    ['a draft-to-open state change', { kind: EPrEventKind.State, state: 'open' }],
  ])('does not forward %s — batching stays with the woken serve', async (_name, extra) => {
    const { forwarder, sent } = parkedRig()
    const base = frame()

    await forwarder.onPrEvent(frame({ kind: extra.kind, payload: { ...base.payload, ...extra } }))

    expect(sent).toHaveLength(0)
  })

  it('matches the subscribed repo case-insensitively', async () => {
    const { forwarder, sent } = parkedRig('github.com/Owner/Repo')

    await forwarder.onPrEvent(frame())

    expect(sent).toHaveLength(1)
  })
})

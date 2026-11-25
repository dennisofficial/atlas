import { describe, expect, it } from 'bun:test'

import type { RecordEventBody } from '@dltech/atlas-core'
import type { PodAnalyticsValue } from '@dltech/atlas-plugin-sdk'

import { reviewIdOf } from '../analytics/review-links'
import { eventsOf, said, turnStarted } from './finding-fixtures'
import { CALL, THREAD, analyticsRecorder, completedOf, createRig, type Captured } from './support'

const reactionReviewIdsOf = (captured: readonly Captured[]): readonly PodAnalyticsValue[] =>
  captured
    .filter((one) => one.event === 'quality nudge reaction')
    .map((one) => one.properties['review_id'] ?? null)

describe('the review id of a quality review', () => {
  it('derives it from the tool call id', async () => {
    const { captured, analytics } = analyticsRecorder()

    await createRig({ analytics }).run()

    expect(completedOf(captured)?.properties['review_id']).toBe(reviewIdOf({ callId: CALL }))
  })

  it('gives two runs of one call id the same review id', async () => {
    const first = analyticsRecorder()
    const second = analyticsRecorder()

    await createRig({ analytics: first.analytics }).run()
    await createRig({ analytics: second.analytics }).run()

    expect(completedOf(first.captured)?.properties['review_id']).toBe(
      completedOf(second.captured)?.properties['review_id'],
    )
  })
})

describe('the nudge reaction after a pod restart', () => {
  it('reports the review id of the review that nudged, from the log alone', async () => {
    const review = analyticsRecorder()
    const outcome = await createRig({ analytics: review.analytics }).run()
    const reviewId = completedOf(review.captured)?.properties['review_id']
    const traceIds = review.captured
      .filter((one) => one.event === '$ai_generation')
      .map((one) => one.properties['$ai_trace_id'])
    const events = eventsOf([
      turnStarted,
      ...((outcome.drafts ?? []) as readonly RecordEventBody[]),
      said,
    ])
    const restarted = analyticsRecorder()
    const restartedRig = createRig({ analytics: restarted.analytics, events: events as never })

    await restartedRig.ignored.run({ threadId: THREAD })

    if (typeof reviewId !== 'string') throw new Error('the review run reported no review id')
    expect(reactionReviewIdsOf(restarted.captured)).toEqual([reviewId])
    expect(traceIds.length).toBeGreaterThan(0)
    for (const traceId of traceIds) expect(traceId).toBe(reviewId)
  })
})

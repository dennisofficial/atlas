import { describe, expect, it } from 'bun:test'

import { EQualityFindingState, EQualityTransition } from '@dltech/atlas-core'

import { closedFindingProperties } from '../analytics/closed-properties'
import { resolvedFindingProperties } from '../analytics/review-properties'
import {
  eventsOf,
  notified,
  resolved,
  retired,
  reviewed,
  said,
  turnStarted,
} from './finding-fixtures'
import { THREAD } from './support'

describe('closedFindingProperties', () => {
  it('reports a notified finding whose scope this write retired', () => {
    const events = eventsOf([notified(), said, turnStarted, said])

    expect(
      closedFindingProperties({
        reviewId: 'review-1',
        records: [retired()],
        events,
        threadId: THREAD,
      }),
    ).toEqual([
      {
        review_id: 'review-1',
        policy_id: 'single-responsibility',
        steps_after_nudge: 2,
        turns_after_nudge: 1,
      },
    ])
  })

  it('says nothing for a finding that was never notified', () => {
    const events = eventsOf([
      reviewed({
        state: EQualityFindingState.Active,
        notified: false,
        transition: EQualityTransition.Introduce,
      }),
    ])

    expect(
      closedFindingProperties({
        reviewId: 'review-1',
        records: [retired({ notified: false })],
        events,
        threadId: THREAD,
      }),
    ).toEqual([])
  })

  it('says nothing for a finding that was already resolved', () => {
    const events = eventsOf([notified(), said, resolved()])

    expect(
      closedFindingProperties({
        reviewId: 'review-1',
        records: [retired()],
        events,
        threadId: THREAD,
      }),
    ).toEqual([])
  })

  it('leaves a classifier resolve to the resolved event alone', () => {
    const events = eventsOf([notified(), said])

    expect(
      closedFindingProperties({
        reviewId: 'review-1',
        records: [resolved()],
        events,
        threadId: THREAD,
      }),
    ).toEqual([])
    expect(
      resolvedFindingProperties({
        reviewId: 'review-1',
        records: [resolved()],
        events,
        threadId: THREAD,
      }),
    ).toHaveLength(1)
  })
})

import { describe, expect, it } from 'bun:test'

import { EQualityReviewStatus, EQualitySkipReason } from '@dltech/atlas-core'

import { QUALITY_REVIEW_BUDGET_MS } from '../quality-dispatch'
import { FakeQuality, dispatchWrite, qualityDispatcher, type ReviewArgs } from './quality-fixtures'

const never = (): Promise<never> => new Promise(() => undefined)

describe('a review port that does not answer', () => {
  it('is cut off at the review budget even though it ignores its signal', async () => {
    const quality = new FakeQuality({ review: never })
    const started = Date.now()

    const drafts = await dispatchWrite(qualityDispatcher({ quality }))

    expect(Date.now() - started).toBeLessThan(QUALITY_REVIEW_BUDGET_MS + 500)
    expect(drafts.map((draft) => draft.type)).toEqual(['tool-result', 'code-quality-reviewed'])
    expect(drafts[0]).not.toHaveProperty('error')
    expect(drafts[1]).toMatchObject({
      status: EQualityReviewStatus.OperationalError,
      reason: EQualitySkipReason.ReviewDeadline,
    })
  })

  it('is aborted through the signal it was handed once the budget runs out', async () => {
    let handed: AbortSignal | undefined
    const quality = new FakeQuality({
      review: (args: ReviewArgs) => {
        handed = args.signal
        return never()
      },
    })

    await dispatchWrite(qualityDispatcher({ quality }))

    expect(handed?.aborted).toBe(true)
  })

  it('is skipped as interrupted when the turn aborts mid-review, keeping the write result', async () => {
    const controller = new AbortController()
    const quality = new FakeQuality({
      review: () => {
        queueMicrotask(() => controller.abort())
        return never()
      },
    })

    const drafts = await dispatchWrite(qualityDispatcher({ quality }), controller.signal)

    expect(drafts.map((draft) => draft.type)).toEqual(['tool-result', 'code-quality-reviewed'])
    expect(drafts[0]).not.toHaveProperty('interrupted')
    expect(drafts[1]).toMatchObject({
      status: EQualityReviewStatus.Skipped,
      reason: EQualitySkipReason.TurnInterrupted,
    })
  })
})

import { describe, expect, it } from 'bun:test'

import { EQualityReviewStatus, LogPort, toCallId, type CodeQualityReviewedBody, type EventDraft, type LogEntry } from '@dltech/atlas-core'

import {
  FakeQuality,
  capturedWrite,
  dispatchWrite,
  qualityDispatcher,
  reviewNudge,
  reviewRecord,
  type NudgeDraft,
  type ReviewRecordDraft,
} from './quality-fixtures'

class ThrowingLog extends LogPort {
  attempts = 0

  record(_entry: LogEntry): void {
    this.attempts += 1
    throw new Error('log sink is down')
  }
}

const typesOf = (drafts: readonly { type: string }[]): string[] => drafts.map((draft) => draft.type)

const reviewsOf = (drafts: readonly { type: string }[]): readonly CodeQualityReviewedBody[] => {
  const result = drafts.find((draft) => draft.type === 'tool-result')
  if (result === undefined || !('qualityReviews' in result)) return []
  return (result as { qualityReviews: readonly CodeQualityReviewedBody[] }).qualityReviews
}

const reviewing = (drafts: readonly EventDraft[]): FakeQuality => new FakeQuality({ review: async () => drafts })

describe('a quality review whose logging sink throws', () => {
  it('still succeeds the write when the capture getter throws', async () => {
    const logPort = new ThrowingLog()
    const quality = new FakeQuality({
      capture: () => {
        throw new Error('settings unreadable')
      },
    })
    const dispatcher = qualityDispatcher({
      quality,
      logPort,
      tool: { invoke: async () => capturedWrite({}) },
    })

    const drafts = await dispatchWrite(dispatcher)

    expect(typesOf(drafts)).toEqual(['tool-result'])
    expect(drafts[0]).not.toHaveProperty('error')
    expect(logPort.attempts).toBe(1)
  })

  it('still succeeds the write and records the fault when the reviewer throws', async () => {
    const logPort = new ThrowingLog()
    const quality = new FakeQuality({
      review: async () => {
        throw new Error('reviewer exploded')
      },
    })

    const drafts = await dispatchWrite(qualityDispatcher({ quality, logPort }))

    expect(typesOf(drafts)).toEqual(['tool-result'])
    expect(drafts[0]).not.toHaveProperty('error')
    expect(reviewsOf(drafts)[0]).toMatchObject({ status: EQualityReviewStatus.OperationalError })
    expect(logPort.attempts).toBe(1)
  })

  it('still substitutes the fault record when the drafts are malformed', async () => {
    const logPort = new ThrowingLog()
    const quality = reviewing([{ ...reviewRecord, durationMs: -1 } satisfies ReviewRecordDraft])

    const drafts = await dispatchWrite(qualityDispatcher({ quality, logPort }))

    expect(typesOf(drafts)).toEqual(['tool-result'])
    expect(reviewsOf(drafts)[0]).toMatchObject({ status: EQualityReviewStatus.OperationalError })
    expect(logPort.attempts).toBe(1)
  })
})

describe('a quality review response that breaks the nudge and record rules', () => {
  const rejected: readonly [string, readonly EventDraft[]][] = [
    ['a nudge that lives longer than one step', [reviewRecord, { ...reviewNudge, lifetimeSteps: 2 } satisfies NudgeDraft]],
    ['a nudge that lives zero steps', [reviewRecord, { ...reviewNudge, lifetimeSteps: 0 } satisfies NudgeDraft]],
    ['more than one nudge', [reviewRecord, reviewNudge, reviewNudge]],
    ['a record for a different call', [{ ...reviewRecord, callId: toCallId('someone-elses') } satisfies ReviewRecordDraft, reviewNudge]],
  ]

  for (const [name, response] of rejected) {
    it(`drops the whole response for ${name}`, async () => {
      const drafts = await dispatchWrite(qualityDispatcher({ quality: reviewing(response) }))

      expect(typesOf(drafts)).toEqual(['tool-result'])
      expect(drafts[0]).not.toHaveProperty('error')
      expect(reviewsOf(drafts)[0]).toMatchObject({
        status: EQualityReviewStatus.OperationalError,
        detail: 'review returned malformed records and they were dropped',
      })
      expect(drafts).not.toContainEqual(reviewNudge)
    })
  }

  it('attaches several records for the call to the tool result and keeps one single-step nudge', async () => {
    const drafts = await dispatchWrite(
      qualityDispatcher({ quality: reviewing([reviewRecord, reviewRecord, reviewNudge]) }),
    )

    expect(typesOf(drafts)).toEqual(['tool-result', 'nudge'])
    expect(reviewsOf(drafts)).toEqual([reviewRecord, reviewRecord])
    expect(drafts[1]).toEqual(reviewNudge)
  })
})

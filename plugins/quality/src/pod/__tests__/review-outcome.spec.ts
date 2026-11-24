import { describe, expect, it } from 'bun:test'

import {
  EQualityReviewStatus,
  EQualitySkipReason,
  toCallId,
  type CodeQualityReviewedBody,
  type ToolOutcome,
} from '@dltech/atlas-core'

import { NO_REVIEW_METRICS, type QualityReviewResult } from '../../review/engine'
import type { QualityNote } from '../../review/review-records'
import type { ReviewArgs } from '../../review/review-context'
import { outcomeOf, reviewWithinBudget, type QualityReviewRun } from '../review-outcome'
import { CALL, PROJECT, monotonicClock, writeCall, wroteWithChanges } from './support'

const reviewed = ({
  status = EQualityReviewStatus.Completed,
}: {
  status?: EQualityReviewStatus
} = {}): CodeQualityReviewedBody => ({
  type: 'code-quality-reviewed',
  callId: CALL,
  workspaceNamespace: PROJECT,
  path: 'src/widget.ts',
  beforeHash: null,
  afterHash: 'a1',
  status,
  assessments: [],
  findings: [],
  durationMs: 1,
})

const noteOf = (content: string): QualityNote => ({ key: 'src/widget.ts', content })

const resultOf = (args: {
  records: QualityReviewResult['records']
  notes: QualityReviewResult['notes']
}): QualityReviewResult => ({ ...NO_REVIEW_METRICS, ...args })

const reviewerThat = (
  work: (args: ReviewArgs) => Promise<QualityReviewResult>,
): QualityReviewRun => ({ review: work })

const reviewOf = async (args: {
  review: QualityReviewRun
  result?: ToolOutcome | undefined
  budgetMs?: number | undefined
  signal?: AbortSignal | undefined
  log?: ((message: string) => void) | undefined
}) => {
  const logs: string[] = []
  const outcome = await reviewWithinBudget({
    review: args.review,
    clock: monotonicClock(),
    log: args.log ?? ((message) => logs.push(message)),
    call: writeCall(),
    result: args.result ?? wroteWithChanges(),
    events: [],
    projectDirectory: PROJECT,
    signal: args.signal ?? new AbortController().signal,
    budgetMs: args.budgetMs ?? 1000,
  })
  return { outcome, logs }
}

const settlesOnAbort = (late: QualityReviewResult) =>
  reviewerThat(async (args) => {
    await new Promise<void>((resolve) => {
      args.signal.addEventListener('abort', () => resolve(), { once: true })
      if (args.signal.aborted) resolve()
    })
    return late
  })

describe('reviewWithinBudget', () => {
  it('returns the records and the finding of a review that beats the budget', async () => {
    const record = reviewed()
    const { outcome, logs } = await reviewOf({
      review: reviewerThat(async () =>
        resultOf({ records: [record], notes: [noteOf('finding A')] }),
      ),
    })

    expect(outcome).toMatchObject({
      records: [record],
      notes: [noteOf('finding A')],
      timings: { scopeBuildMs: 0, classifierMs: 0, totalMs: 0 },
      language: null,
      inputTokens: null,
    })
    expect(logs).toEqual([])
  })

  it('returns nothing for a result that carries no change', async () => {
    const { outcome } = await reviewOf({
      review: reviewerThat(async () => {
        throw new Error('this review is never asked')
      }),
      result: { ok: true, output: {}, modelText: 'wrote' },
    })

    expect(outcome).toMatchObject({
      records: [],
      notes: [],
      timings: { scopeBuildMs: 0, classifierMs: 0, totalMs: 0 },
      language: null,
      inputTokens: null,
    })
  })

  it('records the deadline and no finding when the review runs past the budget', async () => {
    const { outcome, logs } = await reviewOf({
      review: reviewerThat(() => new Promise(() => undefined)),
      budgetMs: 10,
    })

    expect(outcome.records).toHaveLength(1)
    expect(outcome.records[0]).toMatchObject({
      callId: CALL,
      workspaceNamespace: PROJECT,
      status: EQualityReviewStatus.OperationalError,
      reason: EQualitySkipReason.ReviewDeadline,
      detail: 'review exceeded 10ms',
    })
    expect(outcome.notes).toEqual([])
    expect(logs).toEqual([])
  })

  it('drops a completed record that settles after the deadline and keeps the deadline record', async () => {
    const { outcome } = await reviewOf({
      review: settlesOnAbort(resultOf({ records: [reviewed()], notes: [noteOf('late finding')] })),
      budgetMs: 10,
    })

    expect(outcome.records).toHaveLength(1)
    expect(outcome.records[0]).toMatchObject({
      status: EQualityReviewStatus.OperationalError,
      reason: EQualitySkipReason.ReviewDeadline,
    })
    expect(outcome.notes).toEqual([])
  })

  it('keeps the non-completed records of a review that settles after the deadline', async () => {
    const late = reviewed({ status: EQualityReviewStatus.Inconclusive })
    const { outcome } = await reviewOf({
      review: settlesOnAbort(resultOf({ records: [late], notes: [noteOf('late finding')] })),
      budgetMs: 10,
    })

    expect(outcome.records).toEqual([late])
    expect(outcome.notes).toEqual([])
  })

  it('records an operational error and logs it when the review throws', async () => {
    const { outcome, logs } = await reviewOf({
      review: reviewerThat(async () => {
        throw new Error('reviewer exploded')
      }),
    })

    expect(outcome.records[0]).toMatchObject({
      callId: CALL,
      status: EQualityReviewStatus.OperationalError,
      detail: 'review failed: reviewer exploded',
    })
    expect(outcome.notes).toEqual([])
    expect(logs).toHaveLength(1)
  })

  it('records an interruption when the operator aborts mid-review', async () => {
    const controller = new AbortController()
    const { outcome } = await reviewOf({
      review: reviewerThat(() => {
        queueMicrotask(() => controller.abort())
        return new Promise(() => undefined)
      }),
      signal: controller.signal,
    })

    expect(outcome.records[0]).toMatchObject({
      status: EQualityReviewStatus.Skipped,
      reason: EQualitySkipReason.TurnInterrupted,
    })
    expect(outcome.notes).toEqual([])
  })

  it('dropping a malformed record leaves one operational error and a log line', async () => {
    const malformed = {
      ...NO_REVIEW_METRICS,
      records: [{ type: 'code-quality-reviewed', callId: CALL }],
      notes: [],
    } as unknown as QualityReviewResult

    const { outcome, logs } = await reviewOf({
      review: reviewerThat(async () => malformed),
    })

    expect(outcome.records[0]).toMatchObject({
      status: EQualityReviewStatus.OperationalError,
      detail: 'review returned malformed records and they were dropped',
    })
    expect(outcome.notes).toEqual([])
    expect(logs).toHaveLength(1)
  })
})

describe('outcomeOf', () => {
  it('accepts the records of the call it names', () => {
    const record = reviewed()
    expect(
      outcomeOf({
        value: resultOf({ records: [record], notes: [noteOf('finding A')] }),
        callId: CALL,
      }),
    ).toEqual(resultOf({ records: [record], notes: [noteOf('finding A')] }))
  })

  it('rejects a record of another call', () => {
    const value = resultOf({ records: [reviewed()], notes: [] })
    expect(outcomeOf({ value, callId: toCallId('another-call') })).toBeUndefined()
  })

  it('rejects a blank finding', () => {
    expect(
      outcomeOf({ value: resultOf({ records: [], notes: [noteOf('  ')] }), callId: CALL }),
    ).toBeUndefined()
  })

  it('rejects a record that fails the event schema', () => {
    const value = {
      ...NO_REVIEW_METRICS,
      records: [{ ...reviewed(), status: 'not-a-status' }],
      notes: [],
    } as unknown as QualityReviewResult
    expect(outcomeOf({ value, callId: CALL })).toBeUndefined()
  })
})

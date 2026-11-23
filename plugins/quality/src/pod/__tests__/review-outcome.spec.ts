import { describe, expect, it } from 'bun:test'

import {
  EQualityReviewStatus,
  EQualitySkipReason,
  toCallId,
  type CodeQualityReviewedBody,
  type ToolOutcome,
} from '@dltech/atlas-core'

import type { QualityReviewResult } from '../../review/engine'
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
      review: reviewerThat(async () => ({ records: [record], context: 'finding A' })),
    })

    expect(outcome).toEqual({ records: [record], context: 'finding A' })
    expect(logs).toEqual([])
  })

  it('returns nothing for a result that carries no change', async () => {
    const { outcome } = await reviewOf({
      review: reviewerThat(async () => {
        throw new Error('this review is never asked')
      }),
      result: { ok: true, output: {}, modelText: 'wrote' },
    })

    expect(outcome).toEqual({ records: [], context: undefined })
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
    expect(outcome.context).toBeUndefined()
    expect(logs).toEqual([])
  })

  it('drops a completed record that settles after the deadline and keeps the deadline record', async () => {
    const { outcome } = await reviewOf({
      review: settlesOnAbort({ records: [reviewed()], context: 'late finding' }),
      budgetMs: 10,
    })

    expect(outcome.records).toHaveLength(1)
    expect(outcome.records[0]).toMatchObject({
      status: EQualityReviewStatus.OperationalError,
      reason: EQualitySkipReason.ReviewDeadline,
    })
    expect(outcome.context).toBeUndefined()
  })

  it('keeps the non-completed records of a review that settles after the deadline', async () => {
    const late = reviewed({ status: EQualityReviewStatus.Inconclusive })
    const { outcome } = await reviewOf({
      review: settlesOnAbort({ records: [late], context: 'late finding' }),
      budgetMs: 10,
    })

    expect(outcome.records).toEqual([late])
    expect(outcome.context).toBeUndefined()
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
    expect(outcome.context).toBeUndefined()
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
    expect(outcome.context).toBeUndefined()
  })

  it('dropping a malformed record leaves one operational error and a log line', async () => {
    const malformed = {
      records: [{ type: 'code-quality-reviewed', callId: CALL }],
      context: undefined,
    } as unknown as QualityReviewResult

    const { outcome, logs } = await reviewOf({
      review: reviewerThat(async () => malformed),
    })

    expect(outcome.records[0]).toMatchObject({
      status: EQualityReviewStatus.OperationalError,
      detail: 'review returned malformed records and they were dropped',
    })
    expect(outcome.context).toBeUndefined()
    expect(logs).toHaveLength(1)
  })
})

describe('outcomeOf', () => {
  it('accepts the records of the call it names', () => {
    const record = reviewed()
    expect(outcomeOf({ value: { records: [record], context: 'finding A' }, callId: CALL })).toEqual(
      {
        records: [record],
        context: 'finding A',
      },
    )
  })

  it('rejects a record of another call', () => {
    const value = { records: [reviewed()], context: undefined }
    expect(outcomeOf({ value, callId: toCallId('another-call') })).toBeUndefined()
  })

  it('rejects a blank finding', () => {
    expect(outcomeOf({ value: { records: [], context: '  ' }, callId: CALL })).toBeUndefined()
  })

  it('rejects a record that fails the event schema', () => {
    const value = {
      records: [{ ...reviewed(), status: 'not-a-status' }],
      context: undefined,
    } as unknown as QualityReviewResult
    expect(outcomeOf({ value, callId: CALL })).toBeUndefined()
  })
})

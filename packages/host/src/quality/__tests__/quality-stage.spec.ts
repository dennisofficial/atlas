import { describe, expect, it } from 'bun:test'

import {
  EQualityReviewStatus,
  EQualitySkipReason,
  EToolEffect,
  QualityReviewPort,
  toCallId,
  toRunId,
  toThreadId,
  type CodeQualityReviewedBody,
  type EventDraft,
  type ToolCall,
  type ToolOutcome,
} from '@dltech/atlas-core'
import { LogPort, type LogEntry } from '@dltech/atlas-observability'

import { QUALITY_REVIEW_BUDGET_MS, qualityStageOf } from '../quality-stage'

const RUN = toRunId('run-1')

const call: ToolCall = {
  callId: toCallId('call-w'),
  name: 'write',
  input: { path: '/repo/a.ts' },
  threadId: toThreadId('thread-1'),
  effect: EToolEffect.Write,
}

const change = { path: '/repo/a.ts', before: null, after: 'export const a = 1\n' }

const okResult = (extra: Partial<Extract<ToolOutcome, { ok: true }>> = {}): ToolOutcome => ({
  ok: true,
  output: { bytes: 3 },
  modelText: 'wrote a.ts',
  fileChanges: [change],
  ...extra,
})

const reviewRecord = (
  callId = call.callId,
): Extract<EventDraft, { type: 'code-quality-reviewed' }> => ({
  type: 'code-quality-reviewed',
  callId,
  workspaceNamespace: 'repo',
  path: 'a.ts',
  beforeHash: null,
  afterHash: 'h',
  status: EQualityReviewStatus.Completed,
  assessments: [],
  findings: [],
  durationMs: 3,
})

const nudge: EventDraft = { type: 'nudge', text: 'consider splitting', lifetimeSteps: 1 }

class RecordingLog extends LogPort {
  readonly entries: LogEntry[] = []

  record(entry: LogEntry): void {
    this.entries.push(entry)
  }
}

class FakeReview extends QualityReviewPort {
  calls = 0

  constructor(
    private readonly script: {
      capture?: () => boolean
      review?: () => Promise<readonly EventDraft[]>
    } = {},
  ) {
    super()
  }

  captureEnabled(): boolean {
    return this.script.capture?.() ?? true
  }

  async review(): Promise<readonly EventDraft[]> {
    this.calls += 1
    return this.script.review?.() ?? [reviewRecord(), nudge]
  }
}

const stageFor = (args: {
  review: QualityReviewPort
  clock?: () => number
  logPort?: LogPort
  budgetMs?: number
}) =>
  qualityStageOf({
    review: args.review,
    clock: args.clock ?? (() => 1_000),
    logPort: args.logPort,
    ...(args.budgetMs === undefined ? {} : { budgetMs: args.budgetMs }),
  })

const reviewOf = (stage: ReturnType<typeof stageFor>, result: ToolOutcome = okResult()) =>
  stage.review({
    call,
    runId: RUN,
    result,
    events: [],
    projectDirectory: '/repo',
    signal: new AbortController().signal,
  })

const recordOf = (outcome: { reviews: readonly CodeQualityReviewedBody[] }) => {
  const [record] = outcome.reviews
  if (record === undefined) throw new Error('no review record')
  return record
}

describe('qualityStageOf', () => {
  it('asks nothing and calls nothing when the write captured no change', async () => {
    const review = new FakeReview()

    const outcome = await reviewOf(stageFor({ review }), okResult({ fileChanges: [] }))

    expect(outcome).toEqual({ reviews: [], nudge: undefined })
    expect(review.calls).toBe(0)
  })

  it('asks nothing when the write captured only a fault and no change', async () => {
    const review = new FakeReview()

    const outcome = await reviewOf(stageFor({ review }), {
      ok: false,
      reason: 'disk full',
    })

    expect(outcome).toEqual({ reviews: [], nudge: undefined })
    expect(review.calls).toBe(0)
  })

  it('passes valid drafts through unchanged', async () => {
    const outcome = await reviewOf(stageFor({ review: new FakeReview() }))

    expect(outcome.reviews).toEqual([reviewRecord()])
    expect(outcome.nudge).toEqual(nudge)
  })

  it('replaces malformed drafts with one operational-error record and logs it', async () => {
    const log = new RecordingLog()
    const review = new FakeReview({ review: async () => [reviewRecord(toCallId('other')), nudge] })

    const outcome = await reviewOf(stageFor({ review, logPort: log }))

    expect(outcome.reviews).toEqual([
      {
        type: 'code-quality-reviewed',
        callId: call.callId,
        workspaceNamespace: 'unidentified',
        path: '/repo/a.ts',
        beforeHash: null,
        afterHash: null,
        status: EQualityReviewStatus.OperationalError,
        detail: 'review returned malformed records and they were dropped',
        assessments: [],
        findings: [],
        durationMs: 0,
      },
    ])
    expect(outcome.nudge).toBeUndefined()
    expect(log.entries).toHaveLength(1)
  })

  it('records a deadline with no nudge when the review runs past the budget', async () => {
    const review = new FakeReview({ review: () => new Promise(() => undefined) })

    const outcome = await reviewOf(stageFor({ review, budgetMs: 10 }))

    expect(recordOf(outcome)).toMatchObject({
      status: EQualityReviewStatus.OperationalError,
      reason: EQualitySkipReason.ReviewDeadline,
      detail: 'review exceeded 10ms',
    })
    expect(outcome.nudge).toBeUndefined()
  })

  it('records an operational error and logs when the review throws', async () => {
    const log = new RecordingLog()
    const review = new FakeReview({
      review: async () => {
        throw new Error('reviewer exploded')
      },
    })

    const outcome = await reviewOf(stageFor({ review, logPort: log }))

    expect(recordOf(outcome)).toMatchObject({
      status: EQualityReviewStatus.OperationalError,
      detail: 'review failed: reviewer exploded',
    })
    expect(log.entries).toHaveLength(1)
  })

  it('records an interruption when the operator aborts mid-review', async () => {
    const controller = new AbortController()
    const review = new FakeReview({
      review: () => {
        queueMicrotask(() => controller.abort())
        return new Promise(() => undefined)
      },
    })

    const outcome = await stageFor({ review }).review({
      call,
      runId: RUN,
      result: okResult(),
      events: [],
      projectDirectory: '/repo',
      signal: controller.signal,
    })

    expect(recordOf(outcome)).toMatchObject({
      status: EQualityReviewStatus.Skipped,
      reason: EQualitySkipReason.TurnInterrupted,
    })
  })

  it('measures a record duration on the clock it was handed', async () => {
    let now = 1_000
    const review = new FakeReview({
      review: async () => {
        now = 1_042
        throw new Error('reviewer exploded')
      },
    })

    const outcome = await reviewOf(stageFor({ review, clock: () => now }))

    expect(recordOf(outcome).durationMs).toBe(42)
  })
})

describe('qualityStageOf.captureEnabled', () => {
  it('reports the review port answer', () => {
    expect(stageFor({ review: new FakeReview() }).captureEnabled({ threadId: call.threadId })).toBe(
      true,
    )
    expect(
      stageFor({ review: new FakeReview({ capture: () => false }) }).captureEnabled({
        threadId: call.threadId,
      }),
    ).toBe(false)
  })

  it('answers false and logs once when the review port throws', () => {
    const log = new RecordingLog()
    const review = new FakeReview({
      capture: () => {
        throw new Error('settings unreadable')
      },
    })

    const enabled = stageFor({ review, logPort: log }).captureEnabled({ threadId: call.threadId })

    expect(enabled).toBe(false)
    expect(log.entries).toHaveLength(1)
  })

  it('exposes the default budget', () => {
    expect(QUALITY_REVIEW_BUDGET_MS).toBe(1000)
  })
})

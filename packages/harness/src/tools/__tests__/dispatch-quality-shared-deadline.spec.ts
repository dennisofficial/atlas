import { describe, expect, it } from 'bun:test'

import {
  EQualityFindingState,
  EQualityReviewStatus,
  EQualitySkipReason,
  toRunId,
  type CodeQualityReviewedBody,
  type DecisionOutcome,
  type ToolOutcome,
} from '@dltech/atlas-core'

import {
  INTRODUCE,
  answersFor,
  calibrated,
  call,
  createRig,
  stampHistory,
} from '../../quality/__tests__/fixtures'
import { QUALITY_SETTLEMENT_GRACE_MS } from '../../quality/deadline'
import { WorkspaceIdentityDeadlineError } from '../../quality/git-workspace-identity'
import { QualityStage } from '../quality-dispatch'
import { FakeQuality, type ReviewArgs } from './quality-fixtures'

const never = <T>(): Promise<T> => new Promise(() => undefined)
const BUDGET_MS = 60

const fileChange = { path: '/repo/src/a.ts', before: 'old', after: 'new' }
const result: ToolOutcome = { ok: true, output: {}, modelText: 'ok', fileChanges: [fileChange] }

function stageFor(args: { quality: ConstructorParameters<typeof QualityStage>[0]['quality']; budgetMs?: number }) {
  return new QualityStage({ quality: args.quality, logPort: undefined, budgetMs: args.budgetMs ?? BUDGET_MS })
}

const reviewVia = (stage: QualityStage, extra: { events?: Parameters<QualityStage['review']>[0]['events']; signal?: AbortSignal } = {}) =>
  stage.review({
    call,
    runId: toRunId('run-1'),
    result,
    events: extra.events ?? [],
    projectDirectory: '/repo',
    signal: extra.signal ?? new AbortController().signal,
  })

const reviewOf = (outcome: { reviews: readonly CodeQualityReviewedBody[] }): CodeQualityReviewedBody => {
  const record = outcome.reviews[0]
  if (record === undefined) throw new Error('no review record')
  return record
}

describe('the engine under the dispatcher-owned deadline', () => {
  it('hands the port one absolute deadline and a signal that fires with a typed reason', async () => {
    let seen: ReviewArgs | undefined
    const quality = new FakeQuality({
      review: (args) => {
        seen = args
        return never()
      },
    })
    const before = Date.now()
    await reviewVia(stageFor({ quality }))
    expect(seen?.deadlineAt).toBeGreaterThanOrEqual(before + BUDGET_MS)
    expect(seen?.deadlineAt).toBeLessThanOrEqual(Date.now() + BUDGET_MS)
    expect(seen?.signal.aborted).toBe(true)
  })

  it('keeps per-scope deadline records with previous findings and evidencePath, and never nudges late', async () => {
    const introduced = createRig({ decide: async () => calibrated({ answers: answersFor({ verdicts: { srp: INTRODUCE } }) }) })
    const first = await introduced.review()
    const history = stampHistory({ batches: [first] })
    const sink = { record: async () => ({ ok: true as const, relativePath: 'threads/t/quality/examples/scope-1.json' }) }
    const rig = createRig({
      settings: { 'quality.enabled': true, 'quality.recordExamples': true },
      examples: sink,
      decide: (): Promise<DecisionOutcome> => never(),
    })
    const budgetMs = 80
    const started = Date.now()
    const outcome = await reviewVia(stageFor({ quality: rig.engine, budgetMs }), { events: history })

    expect(Date.now() - started).toBeLessThan(budgetMs + QUALITY_SETTLEMENT_GRACE_MS + 150)
    expect(outcome.nudge).toBeUndefined()
    const record = reviewOf(outcome)
    expect(record).toMatchObject({
      status: EQualityReviewStatus.OperationalError,
      reason: EQualitySkipReason.ReviewDeadline,
      path: 'src/a.ts',
      evidencePath: 'threads/t/quality/examples/scope-1.json',
    })
    expect(record.scope?.id).toBe('scope-1')
    expect(record.findings[0]).toMatchObject({ state: EQualityFindingState.Active })
  })

  it('discards a clean or nudging decision that lands after the deadline', async () => {
    const rig = createRig({
      decide: async () => {
        await new Promise((resolve) => setTimeout(resolve, 90))
        return calibrated({ answers: answersFor({ verdicts: { srp: INTRODUCE } }) })
      },
    })
    const outcome = await reviewVia(stageFor({ quality: rig.engine }))
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(outcome.nudge).toBeUndefined()
    expect(reviewOf(outcome)).toMatchObject({ status: EQualityReviewStatus.OperationalError, reason: EQualitySkipReason.ReviewDeadline })
    expect(reviewOf(outcome).assessments).toEqual([])
  })

  it('drops a port that completes cleanly after the deadline and returns the generic fallback', async () => {
    const quality = new FakeQuality({
      review: (args) =>
        new Promise((resolve) =>
          args.signal.addEventListener('abort', () =>
            resolve([
              { type: 'code-quality-reviewed', callId: call.callId, workspaceNamespace: 'ns', path: 'a.ts', beforeHash: null, afterHash: 'h', status: EQualityReviewStatus.Completed, assessments: [], findings: [], durationMs: 1, scope: undefined, detail: 'x' },
              { type: 'nudge', text: 'late', lifetimeSteps: 1 },
            ]),
          ),
        ),
    })
    const outcome = await reviewVia(stageFor({ quality }))
    expect(outcome.nudge).toBeUndefined()
    expect(reviewOf(outcome)).toMatchObject({ status: EQualityReviewStatus.OperationalError, reason: EQualitySkipReason.ReviewDeadline })
  })

  it('bounds a signal-ignoring port to the budget plus the settlement grace', async () => {
    const started = Date.now()
    const outcome = await reviewVia(stageFor({ quality: new FakeQuality({ review: never }) }))
    const elapsed = Date.now() - started
    expect(elapsed).toBeGreaterThanOrEqual(BUDGET_MS - 5)
    expect(elapsed).toBeLessThan(BUDGET_MS + QUALITY_SETTLEMENT_GRACE_MS + 150)
    expect(reviewOf(outcome)).toMatchObject({ reason: EQualitySkipReason.ReviewDeadline })
  })

  it('keeps an operator abort a skipped TurnInterrupted record', async () => {
    const rig = createRig({ decide: (): Promise<DecisionOutcome> => never() })
    const operator = new AbortController()
    setTimeout(() => operator.abort(), 10)
    const outcome = await reviewVia(stageFor({ quality: rig.engine, budgetMs: 500 }), { signal: operator.signal })
    expect(reviewOf(outcome)).toMatchObject({ status: EQualityReviewStatus.Skipped, reason: EQualitySkipReason.TurnInterrupted })
  })

  it('maps the identity adapter typed timeout to ReviewDeadline rather than WorkspaceUnidentified', async () => {
    const rig = createRig({
      identify: async () => {
        throw new WorkspaceIdentityDeadlineError(750)
      },
    })
    const outcome = await reviewVia(stageFor({ quality: rig.engine, budgetMs: 500 }))
    expect(reviewOf(outcome)).toMatchObject({ status: EQualityReviewStatus.OperationalError, reason: EQualitySkipReason.ReviewDeadline })
  })

  it('still reports a plain identity failure as WorkspaceUnidentified', async () => {
    const rig = createRig({
      identify: async () => {
        throw new Error('not a repo')
      },
    })
    const outcome = await reviewVia(stageFor({ quality: rig.engine, budgetMs: 500 }))
    expect(reviewOf(outcome)).toMatchObject({ reason: EQualitySkipReason.WorkspaceUnidentified })
  })
})

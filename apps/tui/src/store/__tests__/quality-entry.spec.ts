import { describe, expect, it } from 'bun:test'

import {
  ECompactionAnchor,
  EQualityFindingState,
  EQualityImpact,
  EQualityLanguage,
  EQualityReviewStatus,
  EQualityScopeKind,
  EQualitySkipReason,
  EQualityTransition,
  type CodeQualityReviewedBody,
  type EventDraft,
  type QualityAssessment,
  type QualityFinding,
  type QualityScopeIdentity,
} from '@dltech/atlas-core'

import { durableEntries } from '../durable-entries'
import { EEntryKind } from '../transcript-model'
import { log } from './fixture'
import { called, callId as callIdOf, result } from './tool-fixture'

const scope: QualityScopeIdentity = {
  id: 'scope-1',
  workspaceNamespace: 'local:workspace',
  path: 'src/widget.ts',
  language: EQualityLanguage.TypeScript,
  kind: EQualityScopeKind.Class,
  name: 'Widget',
  adapterVersion: '1',
  structuralHash: 'structural-1',
  parentScopeId: null,
  lineRange: { start: 1, end: 20 },
}

const assessment = (overrides: Partial<QualityAssessment> = {}): QualityAssessment => ({
  policyId: 'single-responsibility',
  policyVersion: '1',
  scopeId: scope.id,
  status: EQualityReviewStatus.Completed,
  impact: EQualityImpact.Introduced,
  currentConcernProbability: 0.93,
  transition: EQualityTransition.Introduce,
  evidenceIds: ['scope-1#Widget.run'],
  rawAnswers: {},
  ...overrides,
})

const finding = (overrides: Partial<QualityFinding> = {}): QualityFinding => ({
  id: 'finding-1',
  policyId: 'single-responsibility',
  scopeId: scope.id,
  episode: 1,
  state: EQualityFindingState.Active,
  notified: true,
  lastAfterHash: 'after-1',
  policyVersion: '1',
  ...overrides,
})

const review = (overrides: Partial<CodeQualityReviewedBody> = {}): EventDraft => ({
  type: 'code-quality-reviewed',
  callId: callIdOf(1),
  workspaceNamespace: 'local:workspace',
  path: 'src/widget.ts',
  scope,
  beforeHash: 'before-1',
  afterHash: 'after-1',
  status: EQualityReviewStatus.Completed,
  assessments: [],
  findings: [],
  durationMs: 123,
  ...overrides,
})

const writeExchange = (...quality: EventDraft[]): EventDraft[] => [
  called({ n: 1, name: 'write', input: { path: 'src/widget.ts' } }),
  result({ n: 1, name: 'write' }),
  ...quality,
]

describe('quality review transcript entries', () => {
  it('keeps a completed review with nothing to flag silent', () => {
    const entries = durableEntries({
      events: log(writeExchange(review({ assessments: [assessment({ transition: EQualityTransition.None, impact: EQualityImpact.Unchanged })] }))),
    })

    expect(entries.map((entry) => entry.kind)).toEqual([EEntryKind.ToolsRan])
  })

  it('keeps expected skips silent', () => {
    const entries = durableEntries({
      events: log(writeExchange(review({
        status: EQualityReviewStatus.Skipped,
        reason: EQualitySkipReason.OutsideWorkspace,
        scope: undefined,
      }))),
    })

    expect(entries.map((entry) => entry.kind)).toEqual([EEntryKind.ToolsRan])
  })

  it('names the policy when one newly notified finding appears', () => {
    const entries = durableEntries({
      events: log(writeExchange(
        review({ assessments: [assessment()], findings: [finding()] }),
        { type: 'nudge', text: 'Single responsibility says split Widget.', lifetimeSteps: 1 },
      )),
    })
    const entry = entries[1]

    expect(entries.map((entry) => entry.kind)).toEqual([
      EEntryKind.ToolsRan,
      EEntryKind.CodeQualityReviewed,
    ])
    expect(entry?.kind === EEntryKind.CodeQualityReviewed ? entry.text : '').toBe('Single responsibility')
    expect(entry?.kind === EEntryKind.CodeQualityReviewed ? entry.body : '').toContain('split Widget')
    expect(entry?.kind === EEntryKind.CodeQualityReviewed ? entry.failed : true).toBe(false)
  })

  it('counts multiple findings rather than listing their policies', () => {
    const entries = durableEntries({
      events: log(writeExchange(
        review({ assessments: [assessment()], findings: [finding()] }),
        review({
          scope: { ...scope, id: 'scope-2', name: 'Controller' },
          assessments: [assessment({ policyId: 'dependency-direction', scopeId: 'scope-2' })],
          findings: [finding({ id: 'finding-2', policyId: 'dependency-direction', scopeId: 'scope-2' })],
        }),
        { type: 'nudge', text: 'Two policies found concerns.', lifetimeSteps: 1 },
      )),
    })
    const entry = entries[1]

    expect(entries.map((entry) => entry.kind)).toEqual([
      EEntryKind.ToolsRan,
      EEntryKind.CodeQualityReviewed,
    ])
    expect(entry?.kind === EEntryKind.CodeQualityReviewed ? entry.text : '').toBe('2 quality findings')
    expect(entry?.kind === EEntryKind.CodeQualityReviewed ? entry.body : '').toContain('dependency-direction')
  })

  it('shows an operational failure with its reason', () => {
    const entries = durableEntries({
      events: log(writeExchange(review({
        status: EQualityReviewStatus.OperationalError,
        reason: EQualitySkipReason.ReviewDeadline,
        detail: 'review exceeded 1000ms',
      }))),
    })
    const entry = entries[1]

    expect(entries.map((entry) => entry.kind)).toEqual([
      EEntryKind.ToolsRan,
      EEntryKind.CodeQualityReviewed,
    ])
    expect(entry?.kind === EEntryKind.CodeQualityReviewed ? entry.text : '').toBe('Review failed · timed out')
    expect(entry?.kind === EEntryKind.CodeQualityReviewed ? entry.body : '').toContain('review exceeded 1000ms')
    expect(entry?.kind === EEntryKind.CodeQualityReviewed ? entry.failed : false).toBe(true)
  })

  it('keeps tracked existing debt silent', () => {
    const entries = durableEntries({
      events: log(writeExchange(review({
        assessments: [assessment({ transition: EQualityTransition.TrackDebt, impact: EQualityImpact.Worsened })],
        findings: [finding({ notified: true })],
      }))),
    })

    expect(entries.map((entry) => entry.kind)).toEqual([EEntryKind.ToolsRan])
  })

  it('keeps a repeated introduction after an already-notified finding silent', () => {
    const events = log([
      ...writeExchange(review({ assessments: [assessment()], findings: [finding()] })),
      called({ n: 2, name: 'edit', input: { path: 'src/widget.ts' } }),
      result({ n: 2, name: 'edit' }),
      review({
        callId: callIdOf(2),
        assessments: [assessment({ transition: EQualityTransition.Introduce, impact: EQualityImpact.Introduced })],
        findings: [finding({ notified: true })],
      }),
    ])
    const entries = durableEntries({ events })
    const qualityKeys = entries
      .filter((entry) => entry.kind === EEntryKind.CodeQualityReviewed)
      .map((entry) => entry.key)

    expect(entries.filter((entry) => entry.kind === EEntryKind.ToolsRan)).toHaveLength(1)
    expect(qualityKeys).toEqual([`quality:${callIdOf(1)}`])
  })

  it('counts multiple findings of one policy as findings, not policy names', () => {
    const entries = durableEntries({
      events: log(writeExchange(
        review({ assessments: [assessment()], findings: [finding()] }),
        review({
          scope: { ...scope, id: 'scope-2', name: 'Controller' },
          assessments: [assessment({ scopeId: 'scope-2' })],
          findings: [finding({ id: 'finding-2', scopeId: 'scope-2' })],
        }),
        { type: 'nudge', text: 'Two scopes need review.', lifetimeSteps: 1 },
      )),
    })
    const entry = entries[1]

    expect(entry?.kind === EEntryKind.CodeQualityReviewed ? entry.text : '').toBe('2 quality findings')
  })

  it('shows decision failures even when the review record is marked skipped', () => {
    const entries = durableEntries({
      events: log(writeExchange(review({
        status: EQualityReviewStatus.Skipped,
        reason: EQualitySkipReason.DecisionUnavailable,
        detail: 'the decision endpoint refused the review',
      }))),
    })
    const entry = entries[1]

    expect(entry?.kind === EEntryKind.CodeQualityReviewed ? entry.text : '').toBe(
      'Review failed · decision unavailable',
    )
  })

  it('ignores a foreign nudge after a failure-only record', () => {
    const entries = durableEntries({
      events: log(writeExchange(
        review({
          status: EQualityReviewStatus.OperationalError,
          reason: EQualitySkipReason.ReviewDeadline,
          detail: 'review exceeded 1000ms',
        }),
        { type: 'nudge', text: 'the shell finished while you worked', lifetimeSteps: 1 },
      )),
    })
    const entry = entries[1]

    expect(entry?.kind === EEntryKind.CodeQualityReviewed ? entry.body : '').toBe('review exceeded 1000ms')
    expect(entry?.kind === EEntryKind.CodeQualityReviewed ? entry.body : '').not.toContain('shell finished')
  })

  it('does not forget a notified finding across track-debt and skip records', () => {
    const events = log([
      ...writeExchange(
        review({ assessments: [assessment()], findings: [finding()] }),
        { type: 'nudge', text: 'Single responsibility says split Widget.', lifetimeSteps: 1 },
      ),
      review({
        callId: callIdOf(2),
        assessments: [assessment({ transition: EQualityTransition.TrackDebt })],
        findings: [finding()],
      }),
      review({
        callId: callIdOf(3),
        status: EQualityReviewStatus.Skipped,
        reason: EQualitySkipReason.OutsideWorkspace,
        scope: undefined,
        path: '/elsewhere/scratch.ts',
      }),
      review({
        callId: callIdOf(4),
        assessments: [assessment({ transition: EQualityTransition.Introduce })],
        findings: [finding({ notified: true })],
      }),
    ])
    const qualityRows = durableEntries({ events }).filter(
      (entry) => entry.kind === EEntryKind.CodeQualityReviewed,
    )

    expect(qualityRows.map((entry) => entry.key)).toEqual([`quality:${callIdOf(1)}`])
  })

  it('keeps the nudge with its finding when a skip record lands between them', () => {
    const entries = durableEntries({
      events: log(writeExchange(
        review({ assessments: [assessment()], findings: [finding()] }),
        review({
          status: EQualityReviewStatus.Skipped,
          reason: EQualitySkipReason.UnsupportedLanguage,
          scope: undefined,
          path: 'src/styles.css',
        }),
        { type: 'nudge', text: 'Single responsibility says split Widget.', lifetimeSteps: 1 },
      )),
    })
    const entry = entries[1]

    expect(entry?.kind === EEntryKind.CodeQualityReviewed ? entry.body : '').toContain('split Widget')
  })

  it('drops records inside a summarised range instead of orphaning them beside the summary', () => {
    const survivingRecord = review({ assessments: [assessment()], findings: [finding()] })
    const compaction: EventDraft = {
      type: 'history-compacted',
      anchor: ECompactionAnchor.Prefix,
      fromSeq: 1,
      throughSeq: 3,
      summary: 'A write was reviewed.',
      replaced: 2,
    }
    const events = log([survivingRecord, compaction])

    const entries = durableEntries({ events })

    expect(entries.some((entry) => entry.kind === EEntryKind.CodeQualityReviewed)).toBe(false)
    expect(entries.at(-1)?.kind).toBe(EEntryKind.HistoryCompacted)
  })

  it('places a finding after the write and before the following answer', () => {
    const entries = durableEntries({
      events: log([
        ...writeExchange(
          review({ assessments: [assessment()], findings: [finding()] }),
          { type: 'nudge', text: 'Single responsibility says split Widget.', lifetimeSteps: 1 },
        ),
        { type: 'assistant-said', parts: [{ type: 'text', text: 'I split it.' }] },
      ]),
    })

    expect(entries.map((entry) => entry.kind)).toEqual([
      EEntryKind.ToolsRan,
      EEntryKind.CodeQualityReviewed,
      EEntryKind.ModelSaid,
    ])
  })
})

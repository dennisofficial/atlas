import { describe, expect, it } from 'bun:test'

import {
  EQualityFindingState,
  EQualityImpact,
  EQualityLanguage,
  EQualityReviewStatus,
  EQualityScopeKind,
  EQualitySkipReason,
  EQualityTransition,
  toCallId,
  type CodeQualityReviewedBody,
  type QualityAssessment,
  type QualityFinding,
} from '@dltech/atlas-core'

import {
  EQualityNoticeTone,
  qualityNoticeLine,
  qualityNoticeOf,
  type QualityNotice,
} from '../quality-notice'

const review = (overrides: Partial<CodeQualityReviewedBody> = {}): CodeQualityReviewedBody => ({
  type: 'code-quality-reviewed',
  callId: toCallId('call-1'),
  workspaceNamespace: 'local:workspace',
  path: 'src/widget.ts',
  beforeHash: 'before',
  afterHash: 'after',
  status: EQualityReviewStatus.Completed,
  assessments: [],
  findings: [],
  durationMs: 40,
  ...overrides,
})

const assessment = (overrides: Partial<QualityAssessment> = {}): QualityAssessment => ({
  policyId: 'single-responsibility',
  policyVersion: '1',
  scopeId: 'scope-1',
  status: EQualityReviewStatus.Completed,
  impact: EQualityImpact.Introduced,
  currentConcernProbability: 0.9,
  transition: EQualityTransition.Introduce,
  evidenceIds: [],
  rawAnswers: {},
  ...overrides,
})

const finding = (overrides: Partial<QualityFinding> = {}): QualityFinding => ({
  id: 'single-responsibility:scope-1:1',
  policyId: 'single-responsibility',
  scopeId: 'scope-1',
  episode: 1,
  state: EQualityFindingState.Active,
  notified: true,
  lastAfterHash: 'after',
  policyVersion: '1',
  ...overrides,
})

const lineOf = (notice: QualityNotice | null) => {
  if (notice === null) throw new Error('expected a notice')
  return qualityNoticeLine(notice)
}

describe('qualityNoticeOf', () => {
  it('stays silent for a completed review with nothing to flag', () => {
    expect(qualityNoticeOf([review()])).toBeNull()
    expect(qualityNoticeOf([])).toBeNull()
    expect(qualityNoticeOf(undefined)).toBeNull()
  })

  it('stays silent for expected skips', () => {
    const skipped = review({
      status: EQualityReviewStatus.Skipped,
      reason: EQualitySkipReason.OutsideWorkspace,
    })
    expect(qualityNoticeOf([skipped])).toBeNull()
  })

  it('names the single policy behind one newly notified finding', () => {
    const notice = qualityNoticeOf([review({ assessments: [assessment()], findings: [finding()] })])

    expect(notice?.findings).toBe(1)
    expect(notice?.policyIds).toEqual(['single-responsibility'])
  })

  it('counts several findings rather than listing them', () => {
    const notice = qualityNoticeOf([
      review({ assessments: [assessment()], findings: [finding()] }),
      review({
        scope: {
          id: 'scope-2',
          workspaceNamespace: 'local:workspace',
          path: 'src/widget.ts',
          language: EQualityLanguage.TypeScript,
          kind: EQualityScopeKind.Class,
          name: 'Controller',
          adapterVersion: '1',
          structuralHash: 's2',
          parentScopeId: null,
          lineRange: null,
        },
        assessments: [assessment({ scopeId: 'scope-2' })],
        findings: [finding({ id: 'single-responsibility:scope-2:1', scopeId: 'scope-2' })],
      }),
    ])

    expect(notice?.findings).toBe(2)
  })

  it('reports an operational failure when nothing was flagged', () => {
    const notice = qualityNoticeOf([
      review({
        status: EQualityReviewStatus.OperationalError,
        reason: EQualitySkipReason.ReviewDeadline,
      }),
    ])

    expect(notice?.findings).toBe(0)
    expect(notice?.failure).toBe('timed out')
  })
})

describe('qualityNoticeLine', () => {
  it('warns with the policy title for one finding', () => {
    const notice = qualityNoticeOf([review({ assessments: [assessment()], findings: [finding()] })])

    expect(lineOf(notice)).toEqual({
      tone: EQualityNoticeTone.Warning,
      label: 'Single responsibility',
    })
  })

  it('warns with the count for several findings', () => {
    const notice = qualityNoticeOf([
      review({ assessments: [assessment()], findings: [finding()] }),
      review({
        assessments: [assessment({ policyId: 'other', scopeId: 'scope-2' })],
        findings: [finding({ id: 'other:scope-2:1', policyId: 'other', scopeId: 'scope-2' })],
      }),
    ])

    expect(lineOf(notice)).toEqual({
      tone: EQualityNoticeTone.Warning,
      label: '2 quality findings',
    })
  })

  it('fails with the reason for a review that timed out', () => {
    const notice = qualityNoticeOf([
      review({
        status: EQualityReviewStatus.OperationalError,
        reason: EQualitySkipReason.ReviewDeadline,
      }),
    ])

    expect(lineOf(notice)).toEqual({ tone: EQualityNoticeTone.Failure, label: 'review timed out' })
  })
})

import { describe, expect, it } from 'bun:test'

import {
  EQualityImpact,
  EQualityLanguage,
  EQualityReviewStatus,
  EQualityScopeKind,
  EQualityTransition,
  toCallId,
  type CodeQualityReviewedBody,
  type QualityAssessment,
} from '@dltech/atlas-core'

import type { QualityScopeFacts } from '../../../review/engine'
import { scopeAssessedProperties } from '../scope-properties'

const RECORD: CodeQualityReviewedBody = {
  type: 'code-quality-reviewed',
  callId: toCallId('call-1'),
  workspaceNamespace: '/repo',
  path: 'src/Widget.TS',
  scope: {
    id: 'scope-1',
    workspaceNamespace: '/repo',
    path: 'src/Widget.TS',
    language: EQualityLanguage.TypeScript,
    kind: EQualityScopeKind.Class,
    name: 'Widget',
    adapterVersion: '1',
    structuralHash: 'hash-1',
    parentScopeId: null,
    lineRange: null,
  },
  beforeHash: null,
  afterHash: 'after-1',
  status: EQualityReviewStatus.Completed,
  assessments: [],
  findings: [],
  durationMs: 10,
}

const FACTS: QualityScopeFacts = {
  scopeId: 'scope-1',
  changeKind: 'created',
  scopeLines: 12,
  scopeBytes: 240,
  diffLines: 4,
  requestBytes: 900,
  classifierMs: 40,
  deadlineMissed: false,
}

const assessment = (overrides: Partial<QualityAssessment> = {}): QualityAssessment => ({
  policyId: 'single-responsibility',
  policyVersion: '1',
  scopeId: 'scope-1',
  status: EQualityReviewStatus.Completed,
  impact: EQualityImpact.Introduced,
  currentConcernProbability: 0.9,
  transition: EQualityTransition.Introduce,
  evidenceIds: [],
  rawAnswers: {
    impact: { choice: EQualityImpact.Introduced, confidence: 0.9 },
    focus: { choice: 'evidence-1', confidence: 0.85 },
  },
  ...overrides,
})

describe('scopeAssessedProperties', () => {
  it('sends the metadata of one scored scope', () => {
    expect(
      scopeAssessedProperties({
        reviewId: 'review-1',
        record: RECORD,
        assessment: assessment(),
        facts: FACTS,
        notified: [{ policyId: 'single-responsibility', scopeId: 'scope-1' }],
      }),
    ).toEqual({
      review_id: 'review-1',
      scope_id: 'scope-1',
      policy_id: 'single-responsibility',
      policy_version: '1',
      scope_kind: 'class',
      change_kind: 'created',
      language: 'typescript',
      extension: '.ts',
      scope_lines: 12,
      scope_bytes: 240,
      diff_lines: 4,
      request_bytes: 900,
      concern_score: 0.9,
      impact: 'introduced',
      impact_confidence: 0.9,
      focus_confident: true,
      transition: 'introduce',
      verdict: 'nudged',
      near_miss: false,
      concern_threshold: 0.8,
      impact_threshold: 0.8,
      deadline_missed: false,
      classifier_ms: 40,
    })
  })

  it('calls tracked debt a near miss that was not nudged', () => {
    const properties = scopeAssessedProperties({
      reviewId: 'review-1',
      record: RECORD,
      assessment: assessment({
        transition: EQualityTransition.TrackDebt,
        currentConcernProbability: 0.85,
      }),
      facts: FACTS,
      notified: [],
    })

    expect(properties).toMatchObject({ verdict: 'tracked_debt', near_miss: true })
  })

  it('never calls a confident focus on none a focus', () => {
    const properties = scopeAssessedProperties({
      reviewId: 'review-1',
      record: RECORD,
      assessment: assessment({
        rawAnswers: {
          impact: { choice: EQualityImpact.Introduced, confidence: 0.9 },
          focus: { choice: 'none', confidence: 0.99 },
        },
      }),
      facts: FACTS,
      notified: [],
    })

    expect(properties.focus_confident).toBe(false)
  })

  it('reports an unknown scope kind and language as null', () => {
    const properties = scopeAssessedProperties({
      reviewId: 'review-1',
      record: { ...RECORD, scope: undefined },
      assessment: assessment(),
      facts: FACTS,
      notified: [],
    })

    expect(properties).toMatchObject({ scope_kind: null, language: null, extension: '.ts' })
  })
})

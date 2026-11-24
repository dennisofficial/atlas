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
  type QualityScope,
} from '@dltech/atlas-core'

import {
  EQualityHealthStatus,
  QUALITY_HEALTH_LABEL,
  projectQualityHealth,
  type QualityHealthRecord,
} from '../core-logic/health'

const scopeFixture = (): QualityScope => ({
  id: 'scope-1',
  workspaceNamespace: 'local:abc',
  path: '/repo/src/a.ts',
  language: EQualityLanguage.TypeScript,
  kind: EQualityScopeKind.Class,
  name: 'Widget',
  adapterVersion: 'ts-1',
  structuralHash: 'sh-1',
  parentScopeId: null,
  lineRange: { start: 1, end: 10 },
  before: 'class Widget {}',
  after: 'class Widget { run() {} }',
  diff: '+ run() {}',
  beforeHash: 'b1',
  afterHash: 'a1',
  evidence: [{ id: 'ev-1', label: 'run', changed: true }],
  dependencyContext: ['import x'],
  beforeLineRange: { start: 1, end: 1 },
  afterLineRange: { start: 1, end: 10 },
})

const assessmentFixture = (overrides: Partial<QualityAssessment> = {}): QualityAssessment => ({
  policyId: 'srp',
  policyVersion: '1',
  scopeId: 'scope-1',
  status: EQualityReviewStatus.Completed,
  impact: EQualityImpact.Introduced,
  currentConcernProbability: 0.9,
  transition: EQualityTransition.Introduce,
  evidenceIds: ['ev-1'],
  rawAnswers: {},
  ...overrides,
})

const reviewFixture = (
  overrides: Partial<CodeQualityReviewedBody> = {},
): CodeQualityReviewedBody => ({
  type: 'code-quality-reviewed',
  callId: toCallId('call-1'),
  workspaceNamespace: 'local:abc',
  path: 'src/a.ts',
  beforeHash: 'b1',
  afterHash: 'a1',
  status: EQualityReviewStatus.Completed,
  assessments: [],
  findings: [],
  durationMs: 12,
  ...overrides,
})

const record = (overrides: Partial<QualityHealthRecord> = {}): QualityHealthRecord => ({
  ...reviewFixture(),
  at: '2026-10-06T10:00:00.000Z',
  ...overrides,
})

const finding = {
  id: 'srp:scope-1:1',
  policyId: 'srp',
  scopeId: 'scope-1',
  episode: 1,
  state: EQualityFindingState.Active,
  notified: true,
  lastAfterHash: 'a1',
  policyVersion: '1',
}

describe('projectQualityHealth', () => {
  it('reports no review when there are no records', () => {
    const health = projectQualityHealth({ records: [] })
    expect(health).toMatchObject({
      status: EQualityHealthStatus.NoReview,
      path: null,
      scope: null,
      recordedAt: null,
    })
    expect(health.label).toBe(QUALITY_HEALTH_LABEL)
    expect(health.label).toBe('last recorded review')
  })

  it('reports completed-no-finding', () => {
    const health = projectQualityHealth({ records: [record()] })
    expect(health.status).toBe(EQualityHealthStatus.CompletedNoFinding)
  })

  it('reports a finding only for active findings', () => {
    const active = projectQualityHealth({ records: [record({ findings: [finding] })] })
    const resolved = projectQualityHealth({
      records: [record({ findings: [{ ...finding, state: EQualityFindingState.Resolved }] })],
    })
    expect(active.status).toBe(EQualityHealthStatus.Finding)
    expect(resolved.status).toBe(EQualityHealthStatus.CompletedNoFinding)
  })

  it('reports skipped with its reason', () => {
    const health = projectQualityHealth({
      records: [
        record({
          status: EQualityReviewStatus.Skipped,
          reason: EQualitySkipReason.OversizedSource,
          detail: '2 MiB',
        }),
      ],
    })
    expect(health).toMatchObject({
      status: EQualityHealthStatus.Skipped,
      reason: EQualitySkipReason.OversizedSource,
      detail: '2 MiB',
    })
  })

  it('reports inconclusive and operational error distinctly', () => {
    const inconclusive = projectQualityHealth({
      records: [record({ status: EQualityReviewStatus.Inconclusive })],
    })
    const failed = projectQualityHealth({
      records: [record({ status: EQualityReviewStatus.OperationalError })],
    })
    expect(inconclusive.status).toBe(EQualityHealthStatus.Inconclusive)
    expect(failed.status).toBe(EQualityHealthStatus.OperationalError)
  })

  it('uses the latest record for path, scope, policies and timestamp', () => {
    const scope = scopeFixture()
    const health = projectQualityHealth({
      records: [
        record({ path: 'old.ts', at: '2026-10-06T09:00:00.000Z' }),
        record({
          path: 'src/a.ts',
          scope,
          assessments: [
            assessmentFixture({ policyId: 'srp' }),
            assessmentFixture({ policyId: 'other' }),
          ],
          at: '2026-10-06T11:00:00.000Z',
        }),
      ],
    })
    expect(health.path).toBe('src/a.ts')
    expect(health.scope).toEqual({ id: 'scope-1', name: 'Widget', kind: 'class' })
    expect(health.policyIds).toEqual(['srp', 'other'])
    expect(health.recordedAt).toBe('2026-10-06T11:00:00.000Z')
  })
})

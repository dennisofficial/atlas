import type { DecisionAnswer, DecisionQuestion } from '../../ports/decision.port'
import { toCallId } from '../../events/ids'
import { EQualityLanguage, EQualityScopeKind, type QualityScope } from '../change'
import {
  EQualityImpact,
  EQualityReviewStatus,
  EQualityTransition,
  type QualityAssessment,
  type QualityPolicy,
} from '../policy'
import type { CodeQualityReviewedBody } from '../schema'

export function scopeFixture(overrides: Partial<QualityScope> = {}): QualityScope {
  return {
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
    ...overrides,
  }
}

export function assessmentFixture(overrides: Partial<QualityAssessment> = {}): QualityAssessment {
  return {
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
  }
}

export function policyFixture(overrides: Partial<QualityPolicy> = {}): QualityPolicy {
  const id = overrides.id ?? 'srp'
  return {
    id,
    version: '1',
    title: 'Single responsibility',
    description: 'One reason to change',
    settingKey: `quality.policies.${id}`,
    defaultEnabled: true,
    definition: 'a class has one responsibility',
    exceptions: ['data holders'],
    selectScopes: ({ scopes }) => scopes.map((scope) => scope.id),
    questions: (): Record<string, DecisionQuestion> => ({
      concern: { type: 'noul', instructions: 'is there a concern' },
      focus: { type: 'choice', instructions: 'which evidence', criteria: { 'ev-1': 'run' } },
    }),
    interpret: ({ scope, answers }) =>
      assessmentFixture({ policyId: id, scopeId: scope.id, rawAnswers: answers as Record<string, DecisionAnswer> }),
    guidance: () => 'split it',
    ...overrides,
  }
}

export function reviewFixture(overrides: Partial<CodeQualityReviewedBody> = {}): CodeQualityReviewedBody {
  return {
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
  }
}

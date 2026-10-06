import type { DecisionAnswer, DecisionQuestion } from '../ports/decision.port'
import type { QualityScope } from './change'

export enum EQualityImpact {
  Introduced = 'introduced',
  Worsened = 'worsened',
  Improved = 'improved',
  Resolved = 'resolved',
  Unchanged = 'unchanged',
  NotApplicable = 'not_applicable',
  Uncertain = 'uncertain',
}

export enum EQualityTransition {
  None = 'none',
  Introduce = 'introduce',
  TrackDebt = 'track_debt',
  Resolve = 'resolve',
}

export enum EQualityReviewStatus {
  Completed = 'completed',
  Skipped = 'skipped',
  Inconclusive = 'inconclusive',
  OperationalError = 'operational_error',
}

export enum EQualitySkipReason {
  UnsupportedLanguage = 'unsupported_language',
  DeclarationOnly = 'declaration_only',
  OutsideWorkspace = 'outside_workspace',
  SourceUnavailable = 'source_unavailable',
  InvalidText = 'invalid_text',
  InvalidSyntax = 'invalid_syntax',
  OversizedSource = 'oversized_source',
  NoSupportedScope = 'no_supported_scope',
  ScopeIdentityUncertain = 'scope_identity_uncertain',
  Disabled = 'disabled',
  DecisionUnavailable = 'decision_unavailable',
  UncalibratedModel = 'uncalibrated_model',
  OversizedRequest = 'oversized_request',
  ReviewDeadline = 'review_deadline',
  TurnInterrupted = 'turn_interrupted',
  WorkspaceUnidentified = 'workspace_unidentified',
}

export enum EQualityFindingState {
  Active = 'active',
  Resolved = 'resolved',
}

export type QualityCoverageDiagnostic = {
  path: string
  reason: EQualitySkipReason
  detail?: string | undefined
}

export type QualityPolicyDescriptor = {
  id: string
  version: string
  title: string
  description: string
  settingKey: string
  defaultEnabled: boolean
}

export type QualityAssessment = {
  policyId: string
  policyVersion: string
  scopeId: string
  status: EQualityReviewStatus
  impact: EQualityImpact
  currentConcernProbability: number | null
  transition: EQualityTransition
  evidenceIds: readonly string[]
  rawAnswers: Readonly<Record<string, DecisionAnswer>>
  detail?: string | undefined
}

export type QualityFinding = {
  id: string
  policyId: string
  scopeId: string
  episode: number
  state: EQualityFindingState
  notified: boolean
  lastAfterHash: string | null
  policyVersion: string
}

export type QualityPolicy = QualityPolicyDescriptor & {
  definition: string
  exceptions: readonly string[]
  selectScopes(args: { scopes: readonly QualityScope[] }): readonly string[]
  questions(args: { scope: QualityScope }): Record<string, DecisionQuestion>
  interpret(args: {
    scope: QualityScope
    answers: Readonly<Record<string, DecisionAnswer>>
  }): QualityAssessment
  guidance(args: { assessment: QualityAssessment; scope: QualityScope }): string
}

export class QualityContractError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QualityContractError'
  }
}

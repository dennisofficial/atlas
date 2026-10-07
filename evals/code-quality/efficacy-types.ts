import type { QualityAssessment } from '@dltech/atlas-core'

import type { PreparedCase } from './efficacy-judgment'

export const EFFICACY_REPORT_VERSION = 1
export const CONCERN_CLASS_THRESHOLD = 0.5
export const CONCERN_THRESHOLD_NAME = 'currentConcern>=0.5'

export type Ratio = { numerator: number; denominator: number; value: number | null }

export const ratioOf = ({ numerator, denominator }: { numerator: number; denominator: number }): Ratio => ({
  numerator,
  denominator,
  value: denominator === 0 ? null : numerator / denominator,
})

export enum ERowClass {
  Interpretable = 'interpretable',
  Operational = 'operational',
  Structural = 'structural',
}

export enum EOperationalReason {
  Missing = 'missing',
  TaskError = 'task_error',
  ScorerError = 'scorer_error',
  Skipped = 'skipped',
  ModelIdentity = 'model_identity',
  AssessmentOperationalError = 'assessment_operational_error',
}

export enum EStructuralReason {
  MalformedOutput = 'malformed_output',
  MissingAssessment = 'missing_assessment',
  ScopeMismatch = 'scope_mismatch',
  DuplicateAssessment = 'duplicate_assessment',
  UnknownEvidence = 'unknown_evidence',
  ExpectedMismatch = 'expected_mismatch',
}

export type RowIdentity = { caseId: string; trialId: string; variantId: string }

export type InterpretableRow = {
  rowClass: ERowClass.Interpretable
  identity: RowIdentity
  prepared: PreparedCase
  assessment: QualityAssessment
  notified: boolean
  endToEndMs: number
  inferenceMs: number
}

export type UnavailableRow = {
  rowClass: ERowClass.Operational | ERowClass.Structural
  identity: RowIdentity
  prepared: PreparedCase
  reason: EOperationalReason | EStructuralReason
}

export type ClassifiedRow = InterpretableRow | UnavailableRow

export const isInterpretable = (row: ClassifiedRow): row is InterpretableRow => row.rowClass === ERowClass.Interpretable

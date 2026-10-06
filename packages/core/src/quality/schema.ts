import { z } from 'zod'

import type { QualityScopeIdentity } from './change'
import { EQualityLanguage, EQualityScopeKind } from './change'
import { callIdSchema, type CallId } from '../events/ids'
import {
  EQualityFindingState,
  EQualityImpact,
  EQualityReviewStatus,
  EQualitySkipReason,
  EQualityTransition,
  type QualityAssessment,
  type QualityFinding,
} from './policy'

export type CodeQualityReviewedBody = {
  type: 'code-quality-reviewed'
  callId: CallId
  workspaceNamespace: string
  path: string
  scope?: QualityScopeIdentity | undefined
  beforeHash: string | null
  afterHash: string | null
  status: EQualityReviewStatus
  reason?: EQualitySkipReason | undefined
  detail?: string | undefined
  assessments: readonly QualityAssessment[]
  findings: readonly QualityFinding[]
  durationMs: number
  requestedModel?: string | undefined
  resolvedModel?: string | undefined
  evidencePath?: string | undefined
}

const identifier = z.string().min(1)

const probability = z.number().min(0).max(1)

const lineRangeSchema = z
  .object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() })
  .refine((range) => range.start <= range.end, 'line range ends before it starts')

export const qualityScopeIdentitySchema: z.ZodType<QualityScopeIdentity> = z.object({
  id: identifier,
  workspaceNamespace: identifier,
  path: identifier,
  language: z.enum(EQualityLanguage),
  kind: z.enum(EQualityScopeKind),
  name: z.string(),
  adapterVersion: identifier,
  structuralHash: identifier,
  parentScopeId: identifier.nullable(),
  lineRange: lineRangeSchema.nullable(),
})

const decisionAnswerSchema = z.object({
  noul: probability.optional(),
  choice: z.string().optional(),
  score: z.number().finite().optional(),
  probabilities: z.record(z.string(), probability).optional(),
  confidence: probability.optional(),
})

export const qualityAssessmentSchema: z.ZodType<QualityAssessment> = z.object({
  policyId: identifier,
  policyVersion: identifier,
  scopeId: identifier,
  status: z.enum(EQualityReviewStatus),
  impact: z.enum(EQualityImpact),
  currentConcernProbability: probability.nullable(),
  transition: z.enum(EQualityTransition),
  evidenceIds: z.array(identifier).readonly(),
  rawAnswers: z.record(z.string(), decisionAnswerSchema).readonly(),
  detail: z.string().optional(),
})

export const qualityFindingSchema: z.ZodType<QualityFinding> = z.object({
  id: identifier,
  policyId: identifier,
  scopeId: identifier,
  episode: z.number().int().positive(),
  state: z.enum(EQualityFindingState),
  notified: z.boolean(),
  lastAfterHash: z.string().nullable(),
  policyVersion: identifier,
})

export const codeQualityReviewedSchema: z.ZodType<CodeQualityReviewedBody> = z.object({
  type: z.literal('code-quality-reviewed'),
  callId: callIdSchema,
  workspaceNamespace: identifier,
  path: identifier,
  scope: qualityScopeIdentitySchema.optional(),
  beforeHash: z.string().nullable(),
  afterHash: z.string().nullable(),
  status: z.enum(EQualityReviewStatus),
  reason: z.enum(EQualitySkipReason).optional(),
  detail: z.string().optional(),
  assessments: z.array(qualityAssessmentSchema).readonly(),
  findings: z.array(qualityFindingSchema).readonly(),
  durationMs: z.number().finite().nonnegative(),
  requestedModel: identifier.optional(),
  resolvedModel: identifier.optional(),
  evidencePath: identifier.optional(),
})

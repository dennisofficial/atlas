import { z } from 'zod'

export const EVAL_CASE_SCHEMA_VERSION = 1

export enum ECaseReviewState {
  Accepted = 'accepted',
  Provisional = 'provisional',
  Quarantined = 'quarantined',
}

export enum EVerificationOutcome {
  Confirmed = 'confirmed',
  Corrected = 'corrected',
  Ambiguous = 'ambiguous',
}

export type CaseProvenance = {
  group: string
  method: string
  sourceHash: string
  sourceVersion: string
  completeness: string
}

export type CaseVerification = {
  verifier: string
  outcome: EVerificationOutcome
  at: string
  note?: string | undefined
}

export type CaseReview = {
  state: ECaseReviewState
  verifications: readonly CaseVerification[]
}

export type EvalCase<TInput = unknown, TExpected = unknown> = {
  schemaVersion: typeof EVAL_CASE_SCHEMA_VERSION
  id: string
  featureId: string
  input: TInput
  expected: TExpected
  tags: readonly string[]
  provenance: CaseProvenance
  review: CaseReview
}

export type CaseRejection = {
  line: number
  id: string | null
  reason: string
}

export type DecodedCases = {
  cases: readonly EvalCase[]
  rejected: readonly CaseRejection[]
}

const identifier = z.string().min(1)

const caseProvenanceSchema: z.ZodType<CaseProvenance> = z.object({
  group: identifier,
  method: identifier,
  sourceHash: identifier,
  sourceVersion: identifier,
  completeness: z.string(),
})

const caseVerificationSchema: z.ZodType<CaseVerification> = z.object({
  verifier: identifier,
  outcome: z.enum(EVerificationOutcome),
  at: identifier,
  note: z.string().optional(),
})

const caseReviewSchema: z.ZodType<CaseReview> = z.object({
  state: z.enum(ECaseReviewState),
  verifications: z.array(caseVerificationSchema).readonly(),
})

export const evalCaseSchema: z.ZodType<EvalCase> = z.object({
  schemaVersion: z.literal(EVAL_CASE_SCHEMA_VERSION),
  id: identifier,
  featureId: identifier,
  input: z.unknown(),
  expected: z.unknown(),
  tags: z.array(z.string()).readonly(),
  provenance: caseProvenanceSchema,
  review: caseReviewSchema,
})

const extractedId = (value: unknown): string | null => {
  if (typeof value !== 'object' || value === null) return null
  const id = (value as { id?: unknown }).id
  return typeof id === 'string' && id.length > 0 ? id : null
}

export function decodeCasesJsonl({ text }: { text: string }): DecodedCases {
  const cases: EvalCase[] = []
  const rejected: CaseRejection[] = []
  for (const [index, line] of text.split('\n').entries()) {
    if (line.trim() === '') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      rejected.push({ line: index + 1, id: null, reason: 'line is not valid JSON' })
      continue
    }
    const decoded = evalCaseSchema.safeParse(parsed)
    if (!decoded.success) {
      const reason = decoded.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
      rejected.push({ line: index + 1, id: extractedId(parsed), reason })
      continue
    }
    cases.push(decoded.data)
  }
  return { cases, rejected }
}

export type AcceptanceFilter = {
  accepted: readonly EvalCase[]
  excluded: readonly CaseRejection[]
}

export function acceptedOnly({ cases }: { cases: readonly EvalCase[] }): AcceptanceFilter {
  const accepted: EvalCase[] = []
  const excluded: CaseRejection[] = []
  for (const [index, evalCase] of cases.entries()) {
    if (evalCase.review.state === ECaseReviewState.Accepted) {
      accepted.push(evalCase)
      continue
    }
    excluded.push({ line: index + 1, id: evalCase.id, reason: `review state is ${evalCase.review.state}` })
  }
  return { accepted, excluded }
}

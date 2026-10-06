import { z } from 'zod'

import { ECaseReviewState, EVAL_CASE_SCHEMA_VERSION, EVerificationOutcome, type EvalCase } from '../case'
import { ECandidateMethod, type Candidate } from './candidates'
import { identifier } from './inventory'

export { candidateSchema, type Candidate } from './candidates'

export type LabelDraft = {
  candidateId: string
  expected: unknown
  generator: string
  generatedAt: string
}

export type LabelVerification = {
  candidateId: string
  verifier: string
  verifiedAt: string
  outcome: EVerificationOutcome
  correctedExpected?: unknown
  note?: string | undefined
}

export type LabelRefusal = { candidateId: string; reason: string }

export const labelDraftSchema: z.ZodType<LabelDraft> = z.object({
  candidateId: identifier,
  expected: z.unknown(),
  generator: identifier,
  generatedAt: identifier,
})

export const labelVerificationSchema: z.ZodType<LabelVerification> = z.object({
  candidateId: identifier,
  verifier: identifier,
  verifiedAt: identifier,
  outcome: z.enum(EVerificationOutcome),
  correctedExpected: z.unknown().optional(),
  note: z.string().optional(),
})

export function decodeJsonlLines<T>({
  text,
  schema,
}: {
  text: string
  schema: z.ZodType<T>
}): { values: readonly T[]; errors: readonly { line: number; reason: string }[] } {
  const values: T[] = []
  const errors: { line: number; reason: string }[] = []
  for (const [index, line] of text.split('\n').entries()) {
    if (line.trim() === '') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      errors.push({ line: index + 1, reason: 'line is not valid JSON' })
      continue
    }
    const decoded = schema.safeParse(parsed)
    if (!decoded.success) {
      errors.push({ line: index + 1, reason: decoded.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ') })
      continue
    }
    values.push(decoded.data)
  }
  return { values, errors }
}

type Resolution = { expected: unknown } | { reason: string }

function resolveExpected({ draft, verification }: { draft: LabelDraft; verification: LabelVerification }): Resolution {
  if (verification.outcome === EVerificationOutcome.Ambiguous) return { reason: 'marked ambiguous' }
  if (verification.outcome === EVerificationOutcome.Confirmed) return { expected: draft.expected }
  if (verification.correctedExpected === undefined) return { reason: 'corrected without correctedExpected' }
  return { expected: verification.correctedExpected }
}

const completenessOf = (method: ECandidateMethod): string =>
  method === ECandidateMethod.ProspectiveCapture ? 'captured-scope' : 'reconstructed'

function buildCase({
  featureId,
  candidate,
  expected,
  verification,
}: {
  featureId: string
  candidate: Candidate
  expected: unknown
  verification: LabelVerification
}): EvalCase {
  return {
    schemaVersion: EVAL_CASE_SCHEMA_VERSION,
    id: candidate.candidateId,
    featureId,
    input: candidate.change,
    expected,
    tags: [candidate.group],
    provenance: {
      group: candidate.group,
      method: candidate.method,
      sourceHash: candidate.provenance.sourceHash,
      sourceVersion: candidate.provenance.adapterVersion,
      completeness: completenessOf(candidate.method),
    },
    review: {
      state: ECaseReviewState.Accepted,
      verifications: [
        {
          verifier: verification.verifier,
          outcome: verification.outcome,
          at: verification.verifiedAt,
          ...(verification.note === undefined ? {} : { note: verification.note }),
        },
      ],
    },
  }
}

export function buildGoldenCases({
  featureId,
  candidates,
  drafts,
  verifications,
}: {
  featureId: string
  candidates: readonly Candidate[]
  drafts: readonly LabelDraft[]
  verifications: readonly LabelVerification[]
}): { cases: readonly EvalCase[]; refused: readonly LabelRefusal[] } {
  const draftById = new Map(drafts.map((draft) => [draft.candidateId, draft]))
  const verificationById = new Map(verifications.map((verification) => [verification.candidateId, verification]))
  const candidateIds = new Set(candidates.map((candidate) => candidate.candidateId))
  const cases: EvalCase[] = []
  const refused: LabelRefusal[] = []

  for (const candidate of [...candidates].sort((a, b) => a.candidateId.localeCompare(b.candidateId))) {
    const draft = draftById.get(candidate.candidateId)
    const verification = verificationById.get(candidate.candidateId)
    if (draft === undefined) {
      refused.push({ candidateId: candidate.candidateId, reason: 'no draft label' })
      continue
    }
    if (verification === undefined) {
      refused.push({ candidateId: candidate.candidateId, reason: 'unverified' })
      continue
    }
    const resolution = resolveExpected({ draft, verification })
    if ('reason' in resolution) {
      refused.push({ candidateId: candidate.candidateId, reason: resolution.reason })
      continue
    }
    cases.push(buildCase({ featureId, candidate, expected: resolution.expected, verification }))
  }

  for (const verification of verifications) {
    if (!candidateIds.has(verification.candidateId)) {
      refused.push({ candidateId: verification.candidateId, reason: 'verification names an unknown candidate' })
    }
  }

  cases.sort((a, b) => a.id.localeCompare(b.id))
  return { cases, refused }
}

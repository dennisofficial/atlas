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
  input,
  expected,
  verification,
}: {
  featureId: string
  candidate: Candidate
  input: unknown
  expected: unknown
  verification: LabelVerification
}): EvalCase {
  return {
    schemaVersion: EVAL_CASE_SCHEMA_VERSION,
    id: candidate.candidateId,
    featureId,
    input,
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

function indexUnique<T extends { candidateId: string }>({ items }: { items: readonly T[] }): {
  byId: Map<string, T>
  duplicated: Set<string>
} {
  const byId = new Map<string, T>()
  const duplicated = new Set<string>()
  for (const item of items) {
    if (byId.has(item.candidateId)) duplicated.add(item.candidateId)
    else byId.set(item.candidateId, item)
  }
  return { byId, duplicated }
}

export function buildGoldenCases({
  featureId,
  candidates,
  drafts,
  verifications,
  buildInput,
  validateExpected,
}: {
  featureId: string
  candidates: readonly Candidate[]
  drafts: readonly LabelDraft[]
  verifications: readonly LabelVerification[]
  buildInput: (args: { candidate: Candidate }) => unknown
  validateExpected?: ((expected: unknown) => string | null) | undefined
}): { cases: readonly EvalCase[]; refused: readonly LabelRefusal[] } {
  const { byId: draftById, duplicated: duplicateDrafts } = indexUnique({ items: drafts })
  const { byId: verificationById, duplicated: duplicateVerifications } = indexUnique({ items: verifications })
  const candidateIds = new Set(candidates.map((candidate) => candidate.candidateId))
  const cases: EvalCase[] = []
  const refused: LabelRefusal[] = []

  for (const candidate of [...candidates].sort((a, b) => a.candidateId.localeCompare(b.candidateId))) {
    const { candidateId } = candidate
    const refuse = (reason: string): void => {
      refused.push({ candidateId, reason })
    }
    const draft = draftById.get(candidateId)
    const verification = verificationById.get(candidateId)
    if (duplicateDrafts.has(candidateId)) {
      refuse('duplicate draft')
      continue
    }
    if (duplicateVerifications.has(candidateId)) {
      refuse('duplicate verification')
      continue
    }
    if (draft === undefined) {
      refuse('no draft label')
      continue
    }
    if (verification === undefined) {
      refuse('unverified')
      continue
    }
    if (verification.verifier === draft.generator) {
      refuse('verifier is the generator')
      continue
    }
    const resolution = resolveExpected({ draft, verification })
    if ('reason' in resolution) {
      refuse(resolution.reason)
      continue
    }
    if (validateExpected !== undefined && validateExpected(resolution.expected) !== null) {
      refuse('expected fails schema')
      continue
    }
    cases.push(buildCase({ featureId, candidate, input: buildInput({ candidate }), expected: resolution.expected, verification }))
  }

  for (const candidateId of new Set(verifications.map((verification) => verification.candidateId))) {
    if (!candidateIds.has(candidateId)) refused.push({ candidateId, reason: 'verification names an unknown candidate' })
  }

  cases.sort((a, b) => a.id.localeCompare(b.id))
  return { cases, refused }
}

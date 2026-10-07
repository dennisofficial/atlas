import { z } from 'zod'

import type { EvalCase } from '../src/case'
import { sha256Hex } from '../src/hash'
import { codeQualityInputSchema } from './feature'
import { ESrpExpectationKind, srpExpectedSchema, type SrpExpected } from './expected'
import type { QualityScope } from '@dltech/atlas-core'

export type SrpPilotJudgment = {
  caseId: string
  inputHash: string
  notificationWarranted: boolean | null
  rationale: string
  reviewer: string
  reviewerModel?: string | undefined
  reviewedAt?: string | undefined
}

export const srpPilotJudgmentSchema: z.ZodType<SrpPilotJudgment> = z.object({
  caseId: z.string().min(1),
  inputHash: z.string().regex(/^[0-9a-f]{64}$/, 'inputHash is a lowercase sha256 hex digest'),
  notificationWarranted: z.boolean().nullable(),
  rationale: z.string().min(1),
  reviewer: z.string().min(1),
  reviewerModel: z.string().min(1).optional(),
  reviewedAt: z.string().min(1).optional(),
})

export type PreparedCase = {
  evalCase: EvalCase
  expected: SrpExpected
  scope: QualityScope
  judgment: SrpPilotJudgment
  group: string
}

export class EfficacyInputError extends Error {
  readonly problems: readonly string[]

  constructor({ problems }: { problems: readonly string[] }) {
    super(`efficacy input invalid: ${problems.join('; ')}`)
    this.name = 'EfficacyInputError'
    this.problems = problems
  }
}

export const inputHashOf = ({ input }: { input: unknown }): string => sha256Hex({ text: JSON.stringify(input) })

export function parseJudgmentsJsonl({ text }: { text: string }): readonly SrpPilotJudgment[] {
  const problems: string[] = []
  const judgments: SrpPilotJudgment[] = []
  text.split('\n').forEach((line, index) => {
    if (line.trim() === '') return
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      problems.push(`judgment line ${index + 1}: not valid JSON`)
      return
    }
    const decoded = srpPilotJudgmentSchema.safeParse(parsed)
    if (decoded.success) judgments.push(decoded.data)
    else problems.push(`judgment line ${index + 1}: ${decoded.error.issues[0]?.message ?? 'invalid'}`)
  })
  if (problems.length > 0) throw new EfficacyInputError({ problems })
  return judgments
}

function judgmentIndex({ judgments, caseIds, problems }: { judgments: readonly SrpPilotJudgment[]; caseIds: ReadonlySet<string>; problems: string[] }): ReadonlyMap<string, SrpPilotJudgment> {
  const index = new Map<string, SrpPilotJudgment>()
  for (const judgment of judgments) {
    if (!caseIds.has(judgment.caseId)) problems.push(`judgment for unknown case "${judgment.caseId}"`)
    else if (index.has(judgment.caseId)) problems.push(`duplicate judgment for case "${judgment.caseId}"`)
    else index.set(judgment.caseId, judgment)
  }
  return index
}

function evidenceProblems({ evalCase, expected, scope }: { evalCase: EvalCase; expected: SrpExpected; scope: QualityScope }): readonly string[] {
  if (expected.kind === ESrpExpectationKind.Abstain) return []
  const ids = expected.fields.evidenceIds
  const available = new Set(scope.evidence.map((entry) => entry.id))
  const problems: string[] = []
  if (new Set(ids).size !== ids.length) problems.push(`case "${evalCase.id}" expected evidence ids are not unique`)
  for (const id of ids) {
    if (!available.has(id)) problems.push(`case "${evalCase.id}" expected evidence "${id}" is not in the input evidence`)
  }
  return problems
}

export function prepareCases({ cases, judgments }: { cases: readonly EvalCase[]; judgments: readonly SrpPilotJudgment[] }): readonly PreparedCase[] {
  const problems: string[] = []
  const caseIds = new Set<string>()
  for (const evalCase of cases) {
    if (caseIds.has(evalCase.id)) problems.push(`duplicate case id "${evalCase.id}"`)
    caseIds.add(evalCase.id)
  }
  const index = judgmentIndex({ judgments, caseIds, problems })
  const prepared: PreparedCase[] = []
  for (const evalCase of cases) {
    const input = codeQualityInputSchema.safeParse(evalCase.input)
    const expected = srpExpectedSchema.safeParse(evalCase.expected)
    const judgment = index.get(evalCase.id)
    if (!input.success) problems.push(`case "${evalCase.id}" input fails the code-quality input schema`)
    if (!expected.success) problems.push(`case "${evalCase.id}" expected fails the SRP expected schema`)
    if (judgment === undefined) problems.push(`case "${evalCase.id}" has no judgment`)
    else if (judgment.inputHash !== inputHashOf({ input: evalCase.input })) problems.push(`judgment for case "${evalCase.id}" is bound to a different input hash`)
    if (!input.success || !expected.success || judgment === undefined) continue
    problems.push(...evidenceProblems({ evalCase, expected: expected.data, scope: input.data.scope }))
    prepared.push({ evalCase, expected: expected.data, scope: input.data.scope, judgment, group: evalCase.provenance.group })
  }
  if (problems.length > 0) throw new EfficacyInputError({ problems })
  return prepared
}

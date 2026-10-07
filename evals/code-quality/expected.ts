import { z } from 'zod'

import { EQualityImpact } from '@dltech/atlas-core'

export enum ESrpExpectationKind {
  Decided = 'decided',
  Abstain = 'abstain',
}

export type SrpExpectedFields = {
  impact: (typeof EQualityImpact)[keyof typeof EQualityImpact]
  currentConcern: boolean
  evidenceIds: readonly string[]
}

export type SrpExpected =
  | { kind: ESrpExpectationKind.Decided; fields: SrpExpectedFields }
  | { kind: ESrpExpectationKind.Abstain }

const impactValues = Object.values(EQualityImpact) as [string, ...string[]]

const srpExpectedFieldsSchema: z.ZodType<SrpExpectedFields> = z.object({
  impact: z.enum(impactValues) as z.ZodType<SrpExpectedFields['impact']>,
  currentConcern: z.boolean(),
  evidenceIds: z.array(z.string().min(1)).readonly(),
})

export const srpExpectedSchema: z.ZodType<SrpExpected> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal(ESrpExpectationKind.Decided), fields: srpExpectedFieldsSchema }),
  z.object({ kind: z.literal(ESrpExpectationKind.Abstain) }),
])

const inputEvidenceSchema = z.object({ scope: z.object({ evidence: z.array(z.object({ id: z.string() })) }) })

export function expectedEvidenceProblem({ expected, input }: { expected: unknown; input: unknown }): string | null {
  const decoded = srpExpectedSchema.safeParse(expected)
  if (!decoded.success) return 'expected fails the SRP schema'
  if (decoded.data.kind === ESrpExpectationKind.Abstain) return null
  const supplied = inputEvidenceSchema.safeParse(input)
  if (!supplied.success) return 'input has no valid evidence candidates'
  const ids = decoded.data.fields.evidenceIds
  if (new Set(ids).size !== ids.length) return 'expected evidence ids are not unique'
  const available = new Set(supplied.data.scope.evidence.map(entry => entry.id))
  const unknown = ids.find(id => !available.has(id))
  return unknown === undefined ? null : `expected evidence ${unknown} is not supplied by the input`
}

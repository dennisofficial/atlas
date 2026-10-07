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

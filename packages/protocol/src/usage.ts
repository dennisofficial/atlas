import { z } from 'zod'

import { EAuthProvider } from '@dltech/atlas-core'

export const usageReportInputSchema = z.union([
  z.strictObject({ accountId: z.string().min(1) }),
  z.strictObject({ provider: z.enum(EAuthProvider) }),
])

export const usageWindowDtoSchema = z.strictObject({
  utilization: z.number(),
  resetsAt: z.string().nullable(),
})

export const usageReportDtoSchema = z.strictObject({
  accountId: z.string().nullable(),
  label: z.string().nullable(),
  metered: z.boolean(),
  fiveHour: usageWindowDtoSchema.nullable(),
  sevenDay: usageWindowDtoSchema.nullable(),
  fetchedAt: z.string().nullable(),
})

export type UsageReportInput = z.infer<typeof usageReportInputSchema>
export type UsageWindowDto = z.infer<typeof usageWindowDtoSchema>
export type UsageReportDto = z.infer<typeof usageReportDtoSchema>

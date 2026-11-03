import { z } from 'zod'

export enum EProtection {
  Applied = 'applied',
  Failed = 'failed',
  Unsupported = 'unsupported',
}

export const protectionStepSchema = z
  .object({ status: z.enum(EProtection), error: z.string().optional() })
  .strict()

export const protectionReportSchema = z
  .object({ cgroups: protectionStepSchema, oomScoreAdj: protectionStepSchema })
  .strict()

export const daemonMemorySchema = z
  .object({ current: z.number().int().min(0), max: z.number().int().min(0) })
  .strict()

export type ProtectionStep = z.infer<typeof protectionStepSchema>
export type ProtectionReport = z.infer<typeof protectionReportSchema>
export type DaemonMemory = z.infer<typeof daemonMemorySchema>

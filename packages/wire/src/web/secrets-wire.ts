import { z } from 'zod'

export const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,199}$/

export const REAUTH_REQUIRED_CODE = 'REAUTH_REQUIRED'

export const secretSummarySchema = z.object({
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type SecretSummary = z.infer<typeof secretSummarySchema>

export const secretValueSchema = z.object({ value: z.string() })
export type SecretValue = z.infer<typeof secretValueSchema>

export const secretSetSchema = z.strictObject({ value: z.string() })
export type SecretSet = z.infer<typeof secretSetSchema>

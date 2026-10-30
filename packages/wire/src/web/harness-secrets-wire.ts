import { z } from 'zod'

import { personalSecretListSchema, personalSecretNamesSchema } from './personal-resources-wire'
import { secretSetSchema } from './secrets-wire'

export const HARNESS_LOCAL_ONLY_PREFIXES: readonly string[] = ['sandbox-serve:', 'mcp-oauth:']

export const isHarnessLocalOnlyName = (name: string): boolean =>
  HARNESS_LOCAL_ONLY_PREFIXES.some((prefix) => name.startsWith(prefix))

export const harnessSecretListSchema = personalSecretListSchema
export type HarnessSecretList = z.infer<typeof harnessSecretListSchema>

export const harnessSecretNamesSchema = personalSecretNamesSchema
export type HarnessSecretNames = z.infer<typeof harnessSecretNamesSchema>

export const harnessSecretNameSchema = z.strictObject({ name: z.string().min(1) })
export type HarnessSecretName = z.infer<typeof harnessSecretNameSchema>

export const harnessSecretSetSchema = secretSetSchema.extend(harnessSecretNameSchema.shape)
export type HarnessSecretSet = z.infer<typeof harnessSecretSetSchema>

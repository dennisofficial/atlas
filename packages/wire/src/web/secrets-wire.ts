import { z } from 'zod'

export enum ESecretKind {
  Secret = 'secret',
  EnvVar = 'env',
}

export const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,199}$/

export const secretDetailSchema = z.object({
  name: z.string(),
  kind: z.enum(ESecretKind),
  value: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type SecretDetail = z.infer<typeof secretDetailSchema>

export const workspaceSecretSchema = secretDetailSchema.extend({
  updatedBy: z.object({ userId: z.string(), name: z.string() }).nullable(),
})
export type WorkspaceSecret = z.infer<typeof workspaceSecretSchema>

export const secretSetSchema = z.strictObject({
  value: z.string(),
  kind: z.enum(ESecretKind).optional(),
})
export type SecretSet = z.infer<typeof secretSetSchema>

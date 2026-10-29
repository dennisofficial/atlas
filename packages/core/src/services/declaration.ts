import { z } from 'zod'

export const SERVICE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/

export const VITE_ALLOWED_HOSTS_ENV = '__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS'

export const RESERVED_SERVICE_ENV_KEYS: readonly string[] = [
  'PORT',
  'PUBLIC_URL',
  'ATLAS_THREAD_ID',
  VITE_ALLOWED_HOSTS_ENV,
]

export const serviceNameSchema = z.string().regex(SERVICE_NAME_PATTERN)

const declaredEnvSchema = z.record(z.string(), z.string()).superRefine((env, context) => {
  for (const key of Object.keys(env)) {
    if (!RESERVED_SERVICE_ENV_KEYS.includes(key)) continue
    context.addIssue({
      code: 'custom',
      message: `${key} is set by Atlas and cannot be declared`,
      path: [key],
    })
  }
})

export const servicePortalSchema = z.union([
  z.literal(true),
  z.strictObject({
    url: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
  }),
])

export const serviceDeclarationSchema = z.strictObject({
  command: z.string().min(1),
  cwd: z.string().min(1).optional(),
  port: z.number().int().min(1).max(65_535).optional(),
  health: z.string().startsWith('/').optional(),
  env: declaredEnvSchema.optional(),
  portal: servicePortalSchema.optional(),
})

export const servicesFileSchema = z.object({
  services: z.record(z.string(), z.unknown()),
})

export type ServiceDeclaration = z.infer<typeof serviceDeclarationSchema>

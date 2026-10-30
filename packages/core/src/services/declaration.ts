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

const LINK_URL_PATTERN = /^(\/|https?:\/\/)/

const linkUrlSchema = z
  .string()
  .min(1)
  .regex(LINK_URL_PATTERN, 'must start with / or be an absolute http(s) URL')

export const servicePortalSchema = z.union([
  z.literal(true),
  z.strictObject({
    url: linkUrlSchema.optional(),
    title: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
  }),
])

export const serviceLinkSchema = z.strictObject({
  url: linkUrlSchema,
  title: z.string().min(1),
  description: z.string().min(1).optional(),
})

export const serviceDeclarationSchema = z.strictObject({
  command: z.string().min(1),
  cwd: z.string().min(1).optional(),
  port: z.number().int().min(1).max(65_535).optional(),
  health: z.string().startsWith('/').optional(),
  env: declaredEnvSchema.optional(),
  setup: z.array(z.string().min(1)).min(1).optional(),
  portal: servicePortalSchema.optional(),
  portals: z.array(serviceLinkSchema).optional(),
})

export const servicesFileSchema = z.object({
  services: z.record(z.string(), z.unknown()),
})

export type ServiceDeclaration = z.infer<typeof serviceDeclarationSchema>

export type ServiceLinkDeclaration = {
  url: string
  title: string
  description?: string | undefined
}

export function declaredLinks({
  name,
  portal,
  portals,
}: {
  name: string
  portal?: ServiceDeclaration['portal'] | undefined
  portals?: ServiceDeclaration['portals'] | undefined
}): ServiceLinkDeclaration[] {
  const links: ServiceLinkDeclaration[] = []
  if (portal !== undefined) {
    const primary = portal === true ? {} : portal
    links.push({
      url: primary.url ?? '/',
      title: primary.title ?? name,
      ...(primary.description === undefined ? {} : { description: primary.description }),
    })
  }
  for (const link of portals ?? []) links.push({ ...link })
  return links
}

export function resolveLinks({
  links,
  publicUrl,
}: {
  links: readonly ServiceLinkDeclaration[]
  publicUrl: string
}): ServiceLinkDeclaration[] {
  const base = publicUrl.replace(/\/+$/, '')
  return links.map((link) => ({
    ...link,
    url: link.url.startsWith('/') ? `${base}${link.url}` : link.url,
  }))
}

import { z } from 'zod'

import { hashOf } from './hash'

export const SPEC_FILE_NAME = 'artifact.json'

export class ArtifactSpecError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ArtifactSpecError'
  }
}

const isSafeRelativePath = (value: string): boolean => {
  if (value.length === 0) return false
  if (value.startsWith('/') || value.includes('\\') || value.includes('\0')) return false
  const segments = value.split('/')
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

const relativePath = ({ label, allowDot }: { label: string; allowDot: boolean }) =>
  z.string().refine((value) => (allowDot && value === '.') || isSafeRelativePath(value), {
    message: `${label} must be a relative path inside the artifact`,
  })

const buildSchema = z.object({
  runtime: z.enum(['node22']).default('node22'),
  install: z.string().optional(),
  cmd: z.string(),
  outDir: relativePath({ label: 'build.outDir', allowDot: false }),
  timeoutSec: z.number().int().min(10).max(900).default(300),
})

const serveSchema = z.object({
  spa: z.boolean().default(false),
  notFound: relativePath({ label: 'serve.notFound', allowDot: false }).optional(),
})

const publishSchema = z.object({
  include: z.array(z.string()).default([]),
  exclude: z.array(z.string()).default([]),
})

export const artifactSpecSchema = z.object({
  build: buildSchema.optional(),
  serve: serveSchema.prefault({}),
  publish: publishSchema.prefault({}),
})

export type ArtifactSpec = z.infer<typeof artifactSpecSchema>

const describeIssues = (error: z.ZodError): string =>
  error.issues
    .map((issue) => `${issue.path.length === 0 ? 'spec' : issue.path.join('.')}: ${issue.message}`)
    .join('; ')

export function parseSpec(raw: unknown): ArtifactSpec {
  const parsed = artifactSpecSchema.safeParse(raw)
  if (!parsed.success) throw new ArtifactSpecError(describeIssues(parsed.error))
  return parsed.data
}

export function specHash(spec: ArtifactSpec): string {
  return hashOf(parseSpec(spec))
}

import { artifactStatusSchema, type ArtifactBuild, type ArtifactStatus } from '@dltech/atlas-wire'
import type { ArtifactSummary } from '@dltech/atlas-wire'

export type ArtifactRow = {
  id: string
  userId: string
  slug: string
  token: string
  subdomain: string
  name: string
  currentVersion: number
  createdAt: Date
  updatedAt: Date
}

export type BuildRow = {
  id: string
  artifactId: string
  version: number
  status: string
  manifest: unknown
  bytes: number
  fileCount: number
  log: string | null
  failure: string | null
  durationMs: number | null
  createdAt: Date
}

export const statusOf = (raw: string | undefined): ArtifactStatus => {
  if (raw === undefined) return 'building'
  const parsed = artifactStatusSchema.safeParse(raw)
  return parsed.success ? parsed.data : 'failed'
}

export const summaryOf = (args: {
  artifact: ArtifactRow
  build: BuildRow | null
  url: string
}): ArtifactSummary => ({
  subdomain: args.artifact.subdomain,
  name: args.artifact.name,
  url: args.url,
  status: statusOf(args.build?.status),
  updatedAt: (args.build?.createdAt ?? args.artifact.updatedAt).toISOString(),
})

export const buildOf = (args: {
  artifact: ArtifactRow
  build: BuildRow | null
}): ArtifactBuild => ({
  status: statusOf(args.build?.status),
  log: args.build?.log ?? null,
  failure: args.build?.failure ?? null,
  durationMs: args.build?.durationMs ?? null,
  updatedAt: (args.build?.createdAt ?? args.artifact.updatedAt).toISOString(),
})

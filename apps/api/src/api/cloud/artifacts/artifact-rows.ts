import {
  parseManifest,
  parseSpec,
  type ArtifactSpec,
  type ManifestEntry,
} from '@dltech/atlas-artifacts'
import {
  artifactStatusSchema,
  type ArtifactStatus,
  type ArtifactSummary,
  type ArtifactVersionSummary,
} from '@dltech/atlas-wire'

export type ArtifactRow = {
  id: string
  userId: string
  slug: string
  token: string
  name: string
  currentVersion: number
  createdAt: Date
  updatedAt: Date
}

export type VersionRow = {
  id: string
  artifactId: string
  version: number
  status: string
  manifest: unknown
  spec: unknown
  sourceHash: string
  specHash: string
  createdAt: Date
  bytes: number
  fileCount: number
  durationMs: number | null
  log: string | null
  failure: string | null
}

export const statusOf = (raw: string | undefined): ArtifactStatus => {
  const parsed = artifactStatusSchema.safeParse(raw)
  return parsed.success ? parsed.data : 'failed'
}

export const manifestOf = (row: VersionRow | null): ManifestEntry[] =>
  row === null ? [] : parseManifest(row.manifest)

export const specOf = (row: VersionRow): ArtifactSpec => parseSpec(row.spec)

export const totalBytesOf = (entries: readonly ManifestEntry[]): number =>
  entries.reduce((total, entry) => total + entry.size, 0)

export const summaryOf = (args: {
  artifact: ArtifactRow
  current: VersionRow | null
  url: string
}): ArtifactSummary => ({
  slug: args.artifact.slug,
  name: args.artifact.name,
  url: args.url,
  currentVersion: args.artifact.currentVersion,
  status: statusOf(args.current?.status),
  bytes: args.current?.bytes ?? 0,
  fileCount: args.current?.fileCount ?? 0,
  createdAt: args.artifact.createdAt.toISOString(),
  updatedAt: args.artifact.updatedAt.toISOString(),
  sourceHash: args.current?.sourceHash ?? null,
  specHash: args.current?.specHash ?? null,
})

export const versionSummaryOf = (row: VersionRow): ArtifactVersionSummary => ({
  version: row.version,
  status: statusOf(row.status),
  createdAt: row.createdAt.toISOString(),
  bytes: row.bytes,
  fileCount: row.fileCount,
  failure: row.failure,
  durationMs: row.durationMs,
  log: row.log,
})

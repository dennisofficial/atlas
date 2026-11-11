import { z } from 'zod'

export const ARTIFACT_STATUSES = ['building', 'ready', 'failed'] as const

export const artifactStatusSchema = z.enum(ARTIFACT_STATUSES)
export type ArtifactStatus = z.infer<typeof artifactStatusSchema>

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/)

export const artifactEntrySchema = z.strictObject({
  path: z.string().min(1).max(1024),
  tree: z.enum(['src', 'dist']),
  sha256: sha256Schema,
  size: z.number().int().nonnegative(),
  type: z.string().min(1),
})
export type ArtifactEntry = z.infer<typeof artifactEntrySchema>

export const artifactManifestSchema = z.array(artifactEntrySchema)
export type ArtifactManifest = z.infer<typeof artifactManifestSchema>

export const artifactSpecInputSchema = z.record(z.string(), z.unknown())
export type ArtifactSpecInput = z.infer<typeof artifactSpecInputSchema>

export const artifactServeSchema = z.strictObject({
  spa: z.boolean(),
  notFound: z.string().min(1).optional(),
})
export type ArtifactServe = z.infer<typeof artifactServeSchema>

export const artifactRouteSchema = z.strictObject({
  artifactId: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  version: z.number().int().nonnegative(),
  manifest: artifactManifestSchema,
  serve: artifactServeSchema.optional(),
})
export type ArtifactRoute = z.infer<typeof artifactRouteSchema>

export const artifactBeginPublishInputSchema = z.strictObject({
  slug: z.string().min(1).max(40).optional(),
  name: z.string().min(1).max(120).optional(),
  entries: z.array(artifactEntrySchema).min(1).max(10_000),
})
export type ArtifactBeginPublishInput = z.infer<typeof artifactBeginPublishInputSchema>

export const artifactUploadSchema = z.strictObject({
  path: z.string().min(1),
  tree: z.enum(['src', 'dist']),
  sha256: sha256Schema,
  url: z.url(),
})
export type ArtifactUpload = z.infer<typeof artifactUploadSchema>

export const artifactBeginPublishOutputSchema = z.strictObject({
  artifactId: z.string().min(1),
  token: z.string().min(1),
  slug: z.string().min(1),
  version: z.number().int().positive(),
  uploads: z.array(artifactUploadSchema),
})
export type ArtifactBeginPublishOutput = z.infer<typeof artifactBeginPublishOutputSchema>

export const artifactCommitPublishInputSchema = z.strictObject({
  artifactId: z.string().min(1),
  version: z.number().int().positive(),
  spec: artifactSpecInputSchema,
})
export type ArtifactCommitPublishInput = z.infer<typeof artifactCommitPublishInputSchema>

export const artifactCommitPublishOutputSchema = z.strictObject({
  slug: z.string().min(1),
  version: z.number().int().positive(),
  url: z.url(),
  status: artifactStatusSchema,
})
export type ArtifactCommitPublishOutput = z.infer<typeof artifactCommitPublishOutputSchema>

export const artifactSummarySchema = z.strictObject({
  slug: z.string().min(1),
  name: z.string().min(1),
  url: z.url(),
  currentVersion: z.number().int().nonnegative(),
  status: artifactStatusSchema,
  bytes: z.number().int().nonnegative(),
  fileCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
  sourceHash: z.string().nullable(),
  specHash: z.string().nullable(),
})
export type ArtifactSummary = z.infer<typeof artifactSummarySchema>

export const artifactListOutputSchema = z.strictObject({
  artifacts: z.array(artifactSummarySchema),
})
export type ArtifactListOutput = z.infer<typeof artifactListOutputSchema>

export const artifactSlugInputSchema = z.strictObject({ slug: z.string().min(1).max(120) })
export type ArtifactSlugInput = z.infer<typeof artifactSlugInputSchema>

export const artifactVersionSummarySchema = z.strictObject({
  version: z.number().int().positive(),
  status: artifactStatusSchema,
  createdAt: z.string(),
  bytes: z.number().int().nonnegative(),
  fileCount: z.number().int().nonnegative(),
  failure: z.string().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  log: z.string().nullable(),
})
export type ArtifactVersionSummary = z.infer<typeof artifactVersionSummarySchema>

export const artifactGetOutputSchema = z.strictObject({
  artifact: artifactSummarySchema,
  versions: z.array(artifactVersionSummarySchema),
  current: artifactManifestSchema,
})
export type ArtifactGetOutput = z.infer<typeof artifactGetOutputSchema>

export const artifactSourceExportOutputSchema = z.strictObject({
  entries: z.array(z.strictObject({ path: z.string().min(1), url: z.url() })),
})
export type ArtifactSourceExportOutput = z.infer<typeof artifactSourceExportOutputSchema>

export const artifactRollbackInputSchema = z.strictObject({
  slug: z.string().min(1).max(120),
  version: z.number().int().positive(),
})
export type ArtifactRollbackInput = z.infer<typeof artifactRollbackInputSchema>

export const artifactRollbackOutputSchema = z.strictObject({
  url: z.url(),
  version: z.number().int().positive(),
})
export type ArtifactRollbackOutput = z.infer<typeof artifactRollbackOutputSchema>

export const artifactUnpublishOutputSchema = z.strictObject({ ok: z.literal(true) })
export type ArtifactUnpublishOutput = z.infer<typeof artifactUnpublishOutputSchema>

import { z } from 'zod'

export const PUBLISHED_BUNDLE_MAX_BYTES = 256 * 1024 * 1024
export const PUBLISHED_BUNDLE_CONTENT_TYPE = 'application/gzip'

const itemKeySchema = z.string().min(1).max(512)

export const publishedBundleManifestSchema = z.object({
  skills: z.array(itemKeySchema).max(10_000),
  instructions: z.array(itemKeySchema).max(100),
  mcp: z.boolean(),
})
export type PublishedBundleManifest = z.infer<typeof publishedBundleManifestSchema>

export const publishedBundleUploadSchema = z.object({
  pathname: z.string().min(1),
  uploadUrl: z.string().url(),
  contentType: z.literal(PUBLISHED_BUNDLE_CONTENT_TYPE),
  maximumSizeInBytes: z.number().int().positive(),
  validUntil: z.number().int(),
})
export type PublishedBundleUpload = z.infer<typeof publishedBundleUploadSchema>

export const publishedBundleCommitSchema = z.object({
  pathname: z.string().min(1).max(512),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  manifest: publishedBundleManifestSchema,
})
export type PublishedBundleCommit = z.infer<typeof publishedBundleCommitSchema>

export const publishedBundleSummarySchema = z.object({
  version: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  sizeBytes: z.number().int().nonnegative(),
  manifest: publishedBundleManifestSchema,
  createdAt: z.string(),
})
export type PublishedBundleSummary = z.infer<typeof publishedBundleSummarySchema>

export const publishedBundleCurrentSchema = publishedBundleSummarySchema.extend({
  downloadUrl: z.string().url(),
})
export type PublishedBundleCurrent = z.infer<typeof publishedBundleCurrentSchema>

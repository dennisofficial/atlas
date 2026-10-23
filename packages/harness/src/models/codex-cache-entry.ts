import { EEffort, EImageTier, type ModelCard } from '@dltech/atlas-core'
import { z } from 'zod'

const CachedCardSchema = z.object({
  ref: z.object({ providerId: z.string(), modelId: z.string() }),
  label: z.string(),
  api: z.string(),
  contextWindow: z.number(),
  imageTier: z.enum(EImageTier),
  effort: z.partialRecord(z.enum(EEffort), z.union([z.string(), z.number()])).optional(),
})

const CacheEntrySchema = z.object({
  identity: z.string(),
  fetchedAt: z.string(),
  etag: z.string().optional(),
  cards: z.array(CachedCardSchema),
})

export type CacheEntry = { identity: string; fetchedAt: string; etag?: string; cards: ModelCard[] }

const toCacheEntry = (raw: z.infer<typeof CacheEntrySchema>): CacheEntry => ({
  identity: raw.identity,
  fetchedAt: raw.fetchedAt,
  ...(raw.etag === undefined ? {} : { etag: raw.etag }),
  cards: raw.cards.map(({ effort, ...card }) => ({
    ...card,
    ...(effort === undefined ? {} : { effort }),
  })),
})

export const parseCacheEntry = (text: string | undefined): CacheEntry | undefined => {
  if (text === undefined) return undefined
  try {
    const parsed = CacheEntrySchema.safeParse(JSON.parse(text))
    return parsed.success ? toCacheEntry(parsed.data) : undefined
  } catch {
    return undefined
  }
}

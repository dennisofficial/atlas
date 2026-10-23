import { z } from 'zod'

const pinnedListSchema = z.array(z.string())

const listOf = (raw: string): string[] | undefined => {
  try {
    const parsed = pinnedListSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

export const pinnedModelsSettingSchema = z.string().refine((raw) => listOf(raw) !== undefined)

export const PINNED_MODELS_FALLBACK = '[]'

export const parsePinnedModels = (raw: unknown): string[] =>
  typeof raw === 'string' ? (listOf(raw) ?? []) : []

export const encodePinnedModels = (ids: readonly string[]): string => JSON.stringify(ids)

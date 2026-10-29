import { z } from 'zod'

const favouritesListSchema = z.array(z.string())

const listOf = (raw: string): string[] | undefined => {
  if (raw === '') return []
  try {
    const parsed = favouritesListSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

export const pinnedModelsSettingSchema = z.string().refine((raw) => listOf(raw) !== undefined)

export const PINNED_MODELS_FALLBACK = ''

export const decodeModelFavourites = (raw: unknown): string[] =>
  typeof raw === 'string' ? [...new Set(listOf(raw) ?? [])] : []

export const encodeModelFavourites = (ids: readonly string[]): string =>
  ids.length === 0 ? '' : JSON.stringify([...new Set(ids)])

export const parsePinnedModels = decodeModelFavourites

export const encodePinnedModels = encodeModelFavourites

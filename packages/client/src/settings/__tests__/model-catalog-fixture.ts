import { EEffort } from '@dltech/atlas-core'

import type { IModelCatalogEntry } from '../models-settings'

export const MAIN_MODEL = 'anthropic/claude-sonnet-5'
export const SMALL_MODEL = 'openai/gpt-5-mini'
export const STALE_MODEL = 'gateway/deepseek/deepseek-v4'
export const FALLBACK_MODEL = 'anthropic/claude-haiku-4-5'

export const optionsFixture = (): IModelCatalogEntry[] => [
  {
    id: MAIN_MODEL,
    efforts: [EEffort.Low, EEffort.Medium, EEffort.High],
    fast: true,
  },
  { id: SMALL_MODEL, efforts: [EEffort.Medium], fast: false },
  { id: FALLBACK_MODEL, efforts: [EEffort.Low] },
  { id: STALE_MODEL, disabled: true },
]

import { EEffort } from '@dltech/atlas-core'
import type { ModelOption } from '@dltech/atlas-ui/ai/model-selector'

export const MAIN_MODEL = 'anthropic/claude-sonnet-5'
export const SMALL_MODEL = 'openai/gpt-5-mini'
export const STALE_MODEL = 'gateway/deepseek/deepseek-v4'
export const FALLBACK_MODEL = 'anthropic/claude-haiku-4-5'

export const optionsFixture = (): ModelOption[] => [
  {
    id: MAIN_MODEL,
    label: 'Claude Sonnet 5',
    provider: 'anthropic',
    efforts: [EEffort.Low, EEffort.Medium, EEffort.High],
    fast: true,
  },
  {
    id: SMALL_MODEL,
    label: 'GPT-5 mini',
    provider: 'openai',
    efforts: [EEffort.Medium],
    fast: false,
  },
  { id: FALLBACK_MODEL, label: 'Claude Haiku 4.5', provider: 'anthropic', efforts: [EEffort.Low] },
  { id: STALE_MODEL, label: 'DeepSeek', provider: 'gateway', disabled: true },
]

import { describe, expect, it } from 'bun:test'

import type { IModelOption } from '../model-options'
import {
  modelMenuSectionsOf,
  modelMenuSelectionImageOf,
  PINNED_MENU_TITLE,
} from '../model-menu-model'

const model = ({
  id,
  providerId,
  label = id,
}: {
  id: string
  providerId: string
  label?: string
}): IModelOption => ({
  id,
  label,
  provider: providerId,
  providerId,
  monogram: providerId.charAt(0).toUpperCase(),
  efforts: ['low', 'high'],
  context: '200k',
  rate: null,
  fast: false,
})

const MODELS: readonly IModelOption[] = [
  model({ id: 'gpt-5', providerId: 'openai', label: 'GPT-5' }),
  model({ id: 'claude-opus', providerId: 'anthropic', label: 'Opus 4' }),
  model({ id: 'claude-haiku', providerId: 'anthropic', label: 'Haiku 4' }),
]

describe('modelMenuSectionsOf', () => {
  it('groups by provider in the order the models arrive', () => {
    const sections = modelMenuSectionsOf({ models: MODELS, pinned: [] })
    expect(sections.map((section) => section.title)).toEqual(['openai', 'anthropic'])
    expect(sections[1]?.models.map((entry) => entry.id)).toEqual(['claude-opus', 'claude-haiku'])
  })

  it('leads with pinned models in pinned order and keeps them out of their provider', () => {
    const sections = modelMenuSectionsOf({ models: MODELS, pinned: ['claude-haiku', 'gpt-5'] })
    expect(sections[0]?.title).toBe(PINNED_MENU_TITLE)
    expect(sections[0]?.models.map((entry) => entry.id)).toEqual(['claude-haiku', 'gpt-5'])
    expect(sections[1]?.models.map((entry) => entry.id)).toEqual(['claude-opus'])
  })

  it('skips a pinned model the catalogue no longer offers', () => {
    const sections = modelMenuSectionsOf({ models: MODELS, pinned: ['retired-model'] })
    expect(sections.map((section) => section.title)).toEqual(['openai', 'anthropic'])
  })

  it('has no pinned section when nothing is pinned', () => {
    const sections = modelMenuSectionsOf({ models: MODELS, pinned: [] })
    expect(sections.some((section) => section.title === PINNED_MENU_TITLE)).toBe(false)
  })

  it('covers every model once', () => {
    const sections = modelMenuSectionsOf({ models: MODELS, pinned: ['gpt-5'] })
    const ids = sections.flatMap((section) => section.models.map((entry) => entry.id))
    expect(ids).toEqual(['gpt-5', 'claude-opus', 'claude-haiku'])
  })
})

describe('modelMenuSelectionImageOf', () => {
  it('marks the selected model', () => {
    expect(modelMenuSelectionImageOf({ model: MODELS[0]!, selectedId: 'gpt-5' })).toBe('checkmark')
  })

  it('leaves the other models unmarked', () => {
    expect(modelMenuSelectionImageOf({ model: MODELS[1]!, selectedId: 'gpt-5' })).toBeUndefined()
    expect(modelMenuSelectionImageOf({ model: MODELS[1]!, selectedId: null })).toBeUndefined()
  })
})

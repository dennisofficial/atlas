import { describe, expect, it } from 'bun:test'

import {
  hasModelMatchesOf,
  modelListSectionsOf,
  PINNED_SECTION_TITLE,
  type TModelListSection,
} from '../model-list-sections'
import type { IModelOption } from '../model-options'

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

const modelIdsOf = (section: TModelListSection | undefined) =>
  section?.data.map((item) => item.model.id)

describe('modelListSectionsOf', () => {
  it('leads with pinned models, then each provider, with no default option', () => {
    const sections = modelListSectionsOf({ models: MODELS, pinned: ['claude-haiku'], query: '' })
    expect(sections.map((section) => section.title)).toEqual([
      PINNED_SECTION_TITLE,
      'openai',
      'anthropic',
    ])
    expect(modelIdsOf(sections[0])).toEqual(['claude-haiku'])
    expect(modelIdsOf(sections[2])).toEqual(['claude-opus'])
  })

  it('keeps only the matching models while searching', () => {
    const sections = modelListSectionsOf({ models: MODELS, pinned: [], query: 'opus' })
    expect(sections.map((section) => section.title)).toEqual(['anthropic'])
    expect(modelIdsOf(sections[0])).toEqual(['claude-opus'])
  })

  it('gives every row a unique key', () => {
    const sections = modelListSectionsOf({ models: MODELS, pinned: ['gpt-5'], query: '' })
    const keys = sections.flatMap((section) => section.data.map((item) => item.key))
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('hasModelMatchesOf', () => {
  it('is false when no model matches', () => {
    const sections = modelListSectionsOf({ models: MODELS, pinned: [], query: 'nothing' })
    expect(hasModelMatchesOf(sections)).toBe(false)
  })

  it('is true when a model matches', () => {
    const sections = modelListSectionsOf({ models: MODELS, pinned: [], query: 'gpt' })
    expect(hasModelMatchesOf(sections)).toBe(true)
  })
})

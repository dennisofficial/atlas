import { describe, expect, it } from 'bun:test'

import {
  EModelListItem,
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
  section?.data.flatMap((item) => (item.kind === EModelListItem.Model ? [item.model.id] : []))

describe('modelListSectionsOf', () => {
  it('leads with the default row, then pinned models, then each provider', () => {
    const sections = modelListSectionsOf({
      models: MODELS,
      pinned: ['claude-haiku'],
      query: '',
      defaultRow: true,
    })
    expect(sections.map((section) => section.title)).toEqual([
      null,
      PINNED_SECTION_TITLE,
      'openai',
      'anthropic',
    ])
    expect(sections[0]?.data[0]?.kind).toBe(EModelListItem.Default)
    expect(modelIdsOf(sections[1])).toEqual(['claude-haiku'])
    expect(modelIdsOf(sections[3])).toEqual(['claude-opus'])
  })

  it('drops the default row while searching', () => {
    const sections = modelListSectionsOf({
      models: MODELS,
      pinned: [],
      query: 'opus',
      defaultRow: true,
    })
    expect(sections.map((section) => section.title)).toEqual(['anthropic'])
    expect(modelIdsOf(sections[0])).toEqual(['claude-opus'])
  })

  it('leaves the default row out when the caller has none', () => {
    const sections = modelListSectionsOf({
      models: MODELS,
      pinned: [],
      query: '',
      defaultRow: false,
    })
    expect(sections.some((section) => section.title === null)).toBe(false)
  })

  it('gives every row a unique key', () => {
    const sections = modelListSectionsOf({
      models: MODELS,
      pinned: ['gpt-5'],
      query: '',
      defaultRow: true,
    })
    const keys = sections.flatMap((section) => section.data.map((item) => item.key))
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('hasModelMatchesOf', () => {
  it('is false when only the default row is left', () => {
    const sections = modelListSectionsOf({ models: [], pinned: [], query: '', defaultRow: true })
    expect(hasModelMatchesOf(sections)).toBe(false)
  })

  it('is true when a model matches', () => {
    const sections = modelListSectionsOf({
      models: MODELS,
      pinned: [],
      query: 'gpt',
      defaultRow: false,
    })
    expect(hasModelMatchesOf(sections)).toBe(true)
  })
})

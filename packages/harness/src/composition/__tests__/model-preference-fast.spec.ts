import { describe, expect, it } from 'bun:test'

import { ATLAS_SETTINGS, EEffort } from '@dltech/atlas-core'
import { catalogOf, findCard, type ModelCard } from '@dltech/atlas-core'
import { createSettingsService, MemorySettingsStore } from '@dltech/atlas-harness'

import type { ModelCatalogue } from '../model-catalogue'
import {
  defaultSelection,
  launchSelection,
  storedModel,
  threadSelection,
} from '../model-preference'
import { fakeCatalogue } from './fakes'

const base = fakeCatalogue()
const FAST_OPUS: ModelCard = {
  ...(base.cardFor({ providerId: 'anthropic', modelId: 'claude-opus-5' }) as ModelCard),
  fast: true,
}
const catalog = catalogOf([
  FAST_OPUS,
  ...[...base.catalog.values()].filter((card) => card.ref.modelId !== 'claude-opus-5'),
])
const catalogue: ModelCatalogue = {
  ...base,
  catalog,
  cardFor: (ref) => findCard({ catalog, ref }),
}

const settled = (values: Record<string, string | boolean>) =>
  createSettingsService({
    definitions: ATLAS_SETTINGS,
    user: new MemorySettingsStore({ document: { values } }),
  }).snapshot().resolution

describe('fast mode in a conversation model', () => {
  it('starts off unless the default says otherwise', () => {
    const selection = defaultSelection({
      settled: settled({ 'model.id': 'anthropic/claude-opus-5' }),
      catalogue,
    })
    expect(selection.fast).toBe(false)
  })

  it('follows the fast default onto a model that offers it', () => {
    const selection = defaultSelection({
      settled: settled({ 'model.id': 'anthropic/claude-opus-5', 'model.fast': true }),
      catalogue,
    })
    expect(selection.fast).toBe(true)
  })

  it('drops a stored fast flag on a model that does not offer it', () => {
    const fallback = defaultSelection({ settled: settled({}), catalogue })
    const selection = threadSelection({
      stored: { ref: 'anthropic/claude-sonnet-5', effort: EEffort.Low, fast: true },
      fallback,
      catalogue,
    })
    expect(selection.fast).toBe(false)
  })

  it('boots a launch with the fast flag it carried, over the default', () => {
    const onByDefault = settled({ 'model.fast': true })
    const off = launchSelection({
      requested: { model: { ref: 'anthropic/claude-opus-5', effort: 'high', fast: false } },
      settled: onByDefault,
      catalogue,
    })
    const on = launchSelection({
      requested: { model: { ref: 'anthropic/claude-opus-5', fast: true } },
      settled: settled({}),
      catalogue,
    })
    expect(off.fast).toBe(false)
    expect(on.fast).toBe(true)
  })

  it('round-trips through the stored thread model only when on', () => {
    const on = { ref: FAST_OPUS.ref, effort: EEffort.High, fast: true }
    expect(storedModel(on)).toEqual({ ref: 'anthropic/claude-opus-5', effort: 'high', fast: true })
    expect(storedModel({ ...on, fast: false })).not.toHaveProperty('fast')
  })
})

import { describe, expect, it } from 'bun:test'

import { EEffort } from '@dltech/atlas-ui/ai/model-selector'

import { modelOptionsOf } from '../model-options'
import {
  createFieldsOf,
  defaultSelectionOf,
  existingSelectionOf,
  selectionAfterPick,
  UNSET_SELECTION,
} from '../model-selection'

const { models } = modelOptionsOf({
  accounts: [
    { provider: 'anthropic', status: 'active' },
    { provider: 'openai', status: 'active' },
  ],
})
const SHIPPED = 'anthropic/claude-haiku-4-5'
const withLadder = models.find((model) => (model.efforts?.length ?? 0) > 0)
const withoutLadder = models.find((model) => model.efforts?.length === 0)

describe('createFieldsOf', () => {
  it('omits model and effort before any model is known', () => {
    expect(createFieldsOf(UNSET_SELECTION)).toEqual({})
  })

  it('sends both for a picked model', () => {
    expect(createFieldsOf({ id: 'anthropic/x', effort: EEffort.High })).toEqual({
      model: 'anthropic/x',
      effort: 'high',
    })
  })
})

describe('defaultSelectionOf', () => {
  it('uses the personal model and effort when the ref is offered', () => {
    expect(
      defaultSelectionOf({ models, personalId: withLadder?.id ?? '', personalEffort: 'low' }),
    ).toEqual({ id: withLadder?.id ?? '', effort: EEffort.Low })
  })

  it('falls back to the shipped default when the personal ref is not offered or empty', () => {
    expect(defaultSelectionOf({ models, personalId: 'nope/none', personalEffort: 'low' }).id).toBe(
      SHIPPED,
    )
    expect(defaultSelectionOf({ models, personalId: '', personalEffort: 'low' }).id).toBe(SHIPPED)
  })

  it('skips a personal model whose provider has no key', () => {
    const dormant = [
      { id: 'anthropic/claude-haiku-4-5', label: 'Haiku', disabled: true },
      { id: 'openai/gpt-5', label: 'GPT-5', disabled: true },
      { id: 'openrouter/v/m1', label: 'M1' },
      { id: 'openrouter/v/m2', label: 'M2' },
    ]
    expect(
      defaultSelectionOf({ models: dormant, personalId: 'openai/gpt-5', personalEffort: 'low' }).id,
    ).toBe('openrouter/v/m1')
  })

  it('stays unset when every offered model is disabled', () => {
    const dormant = [{ id: 'openai/gpt-5', label: 'GPT-5', disabled: true }]
    expect(
      defaultSelectionOf({ models: dormant, personalId: 'openai/gpt-5', personalEffort: 'low' }),
    ).toEqual(UNSET_SELECTION)
  })

  it('stays unset while no model is offered', () => {
    expect(defaultSelectionOf({ models: [], personalId: '', personalEffort: 'low' })).toEqual(
      UNSET_SELECTION,
    )
  })

  it('clamps a personal effort the model does not offer', () => {
    const picked = defaultSelectionOf({
      models,
      personalId: withLadder?.id ?? '',
      personalEffort: 'off',
    })
    expect(withLadder?.efforts).toContain(picked.effort)
  })
})

describe('selectionAfterPick', () => {
  it('keeps the effort when the new model offers it', () => {
    const first = withLadder?.efforts?.[0] ?? EEffort.Low
    expect(selectionAfterPick({ models, id: withLadder?.id ?? '', effort: first })).toEqual({
      id: withLadder?.id ?? '',
      effort: first,
    })
  })

  it('moves to the nearest offered effort above, else the highest', () => {
    const picked = selectionAfterPick({ models, id: withLadder?.id ?? '', effort: EEffort.Off })
    expect(withLadder?.efforts).toContain(picked.effort)
    const top = withLadder?.efforts?.at(-1)
    expect(
      selectionAfterPick({ models, id: withLadder?.id ?? '', effort: EEffort.Max }).effort,
    ).toBe(withLadder?.efforts?.includes(EEffort.Max) ? EEffort.Max : top)
  })

  it('keeps the effort for a model with no ladder', () => {
    expect(
      selectionAfterPick({ models, id: withoutLadder?.id ?? '', effort: EEffort.High }).effort,
    ).toBe(EEffort.High)
  })
})

describe('existingSelectionOf', () => {
  it('reads the thread model, or unset when it has none', () => {
    expect(existingSelectionOf({ ref: 'a/b', effort: 'high' })).toEqual({
      id: 'a/b',
      effort: EEffort.High,
    })
    expect(existingSelectionOf(undefined)).toEqual(UNSET_SELECTION)
    expect(existingSelectionOf({ ref: 'a/b', effort: 'weird' }).effort).toBe(EEffort.Medium)
  })
})

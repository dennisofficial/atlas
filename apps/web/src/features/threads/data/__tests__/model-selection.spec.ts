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

  it('falls back to the first offered model when the personal ref is not offered or empty', () => {
    const first = models[0]?.id ?? ''
    expect(defaultSelectionOf({ models, personalId: 'nope/none', personalEffort: 'low' }).id).toBe(
      first,
    )
    expect(defaultSelectionOf({ models, personalId: '', personalEffort: 'low' }).id).toBe(first)
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

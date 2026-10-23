import { describe, expect, it } from 'bun:test'

import { EEffort } from '@dltech/atlas-ui/ai/model-selector'

import { AUTO_MODEL_ID, modelOptionsOf } from '../model-options'
import {
  AUTO_SELECTION,
  createFieldsOf,
  defaultSelectionOf,
  existingSelectionOf,
  selectionAfterPick,
} from '../model-selection'

const { models } = modelOptionsOf({
  accounts: [
    { provider: 'anthropic', status: 'active' },
    { provider: 'openai', status: 'active' },
  ],
})
const withLadder = models.find((model) => (model.efforts?.length ?? 0) > 0 && !model.auto)
const withoutLadder = models.find((model) => model.efforts?.length === 0)

describe('createFieldsOf', () => {
  it('omits model and effort for Auto', () => {
    expect(createFieldsOf(AUTO_SELECTION)).toEqual({})
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

  it('falls back to Auto when the personal ref is not offered or empty', () => {
    expect(defaultSelectionOf({ models, personalId: 'nope/none', personalEffort: 'low' })).toEqual(
      AUTO_SELECTION,
    )
    expect(defaultSelectionOf({ models, personalId: '', personalEffort: 'low' })).toEqual(
      AUTO_SELECTION,
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

  it('keeps the effort for a model with no ladder and for Auto', () => {
    expect(
      selectionAfterPick({ models, id: withoutLadder?.id ?? '', effort: EEffort.High }).effort,
    ).toBe(EEffort.High)
    expect(selectionAfterPick({ models, id: AUTO_MODEL_ID, effort: EEffort.High })).toEqual({
      id: AUTO_MODEL_ID,
      effort: EEffort.High,
    })
  })
})

describe('existingSelectionOf', () => {
  it('reads the thread model, or Auto when it has none', () => {
    expect(existingSelectionOf({ ref: 'a/b', effort: 'high' })).toEqual({
      id: 'a/b',
      effort: EEffort.High,
    })
    expect(existingSelectionOf(undefined)).toEqual(AUTO_SELECTION)
    expect(existingSelectionOf({ ref: 'a/b', effort: 'weird' }).effort).toBe(EEffort.Medium)
  })
})

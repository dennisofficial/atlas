import { describe, expect, it } from 'bun:test'

import { EEffort } from '@dltech/atlas-core'

import { MAIN_MODEL, optionsFixture, SMALL_MODEL } from './model-options-fixture'
import { choiceOf, resolveRoles } from '../model-roles'
import {
  effortDraft,
  fastDraft,
  followedDraft,
  modelsChanges,
  modelsDraftFrom,
  pickedModelDraft,
} from '../models-settings'

const saved = () => modelsDraftFrom(new Map())

describe('modelsDraftFrom', () => {
  it('reads unset roles as followers', () => {
    const draft = saved()
    expect(draft.main).toEqual({ model: '', effort: '', fast: false })
    expect(draft['agent-type:teammate']).toEqual({ model: '', effort: '', fast: false })
    expect(draft['agent-type:builder']).toEqual({ model: '', effort: '', fast: false })
  })

  it('reads a stored model, effort and fast per role', () => {
    const draft = modelsDraftFrom(
      new Map<string, string | boolean>([
        ['model.id', MAIN_MODEL],
        ['model.effort', 'high'],
        ['model.fast', true],
        ['agents.type.teammate', SMALL_MODEL],
      ]),
    )
    expect(draft.main).toEqual({ model: MAIN_MODEL, effort: 'high', fast: true })
    expect(draft['agent-type:teammate']?.model).toBe(SMALL_MODEL)
  })
})

describe('modelsChanges', () => {
  it('diffs only what changed', () => {
    const base = saved()
    expect(modelsChanges({ saved: base, draft: base })).toEqual({})
    const changes = modelsChanges({
      saved: base,
      draft: effortDraft({ draft: base, role: 'main', effort: EEffort.High }),
    })
    expect(changes).toEqual({ 'model.effort': 'high' })
  })

  it('follow clears the role to empty values', () => {
    const base = { ...saved(), main: { model: MAIN_MODEL, effort: 'high', fast: true } }
    const cleared = followedDraft({ draft: base, role: 'main' })
    expect(modelsChanges({ saved: base, draft: cleared })).toEqual({
      'model.id': '',
      'model.effort': '',
      'model.fast': false,
    })
  })

  it('writes a fast change for a role that owns a model', () => {
    const base = { ...saved(), main: { model: MAIN_MODEL, effort: 'high', fast: false } }
    const changed = fastDraft({ draft: base, role: 'main', fast: true })
    expect(modelsChanges({ saved: base, draft: changed })).toEqual({ 'model.fast': true })
  })
})

describe('pickedModelDraft', () => {
  it('clamps the effort to the new model rungs and drops unsupported fast', () => {
    const models = optionsFixture()
    const base = { ...saved(), main: { model: MAIN_MODEL, effort: 'max', fast: true } }
    const choices = resolveRoles({ draft: base, models })
    const picked = pickedModelDraft({
      draft: base,
      role: 'main',
      model: SMALL_MODEL,
      option: models.find((model) => model.id === SMALL_MODEL),
      inherited: choiceOf({ choices, role: 'main' }),
    })
    expect(picked.main).toEqual({ model: SMALL_MODEL, effort: 'medium', fast: false })
  })

  it('starts a follower from the model, effort and fast it inherited', () => {
    const models = optionsFixture()
    const base = { ...saved(), main: { model: MAIN_MODEL, effort: 'high', fast: true } }
    const choices = resolveRoles({ draft: base, models })
    const inherited = choiceOf({ choices, role: 'subagents' })
    expect(inherited.effort).toBe(EEffort.High)
    expect(inherited.fast).toBe(true)
    const picked = pickedModelDraft({
      draft: base,
      role: 'subagents',
      model: MAIN_MODEL,
      option: models.find((model) => model.id === MAIN_MODEL),
      inherited,
    })
    expect(picked.subagents).toEqual({ model: MAIN_MODEL, effort: 'high', fast: true })
  })
})

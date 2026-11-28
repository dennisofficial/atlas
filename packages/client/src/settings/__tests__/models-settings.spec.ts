import { describe, expect, it } from 'bun:test'

import { EEffort, EModelRole, roleKey, type ModelRole } from '@dltech/atlas-core'

import { MAIN_MODEL, optionsFixture, SMALL_MODEL } from './model-catalog-fixture'
import { choiceOf, ownsModel, resolveRoles } from '../model-roles'
import {
  effortDraft,
  fastDraft,
  followedDraft,
  modelsChanges,
  modelsDraftFrom,
  pickedModelDraft,
  flattenModelsDraft,
  unfollowedDraft,
  type IModelsDraft,
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
      draft: effortDraft({ draft: base, role: EModelRole.Main, effort: EEffort.High }),
    })
    expect(changes).toEqual({ 'model.effort': 'high' })
  })

  it('follow clears the role to empty values', () => {
    const base = { ...saved(), main: { model: MAIN_MODEL, effort: 'high', fast: true } }
    const cleared = followedDraft({ draft: base, role: EModelRole.Main })
    expect(modelsChanges({ saved: base, draft: cleared })).toEqual({
      'model.id': '',
      'model.effort': '',
      'model.fast': false,
    })
  })

  it('writes a fast change for a role that owns a model', () => {
    const base = { ...saved(), main: { model: MAIN_MODEL, effort: 'high', fast: false } }
    const changed = fastDraft({ draft: base, role: EModelRole.Main, fast: true })
    expect(modelsChanges({ saved: base, draft: changed })).toEqual({ 'model.fast': true })
  })
})

describe('unfollowedDraft', () => {
  const roles: ModelRole[] = [
    EModelRole.Subagents,
    { agentType: 'teammate' },
    { agentType: 'builder' },
  ]

  for (const role of roles) {
    it(`keeps the inherited choice after saving and reloading ${roleKey(role)}`, () => {
      const models = optionsFixture()
      const base: IModelsDraft = {
        ...saved(),
        main: { model: MAIN_MODEL, effort: 'high', fast: true },
      }
      const inherited = choiceOf({ choices: resolveRoles({ draft: base, models }), role })
      const detached = unfollowedDraft({ draft: base, role, inherited })
      expect(detached[roleKey(role)]).toEqual({ model: MAIN_MODEL, effort: 'high', fast: true })
      const reloaded = modelsDraftFrom(new Map(Object.entries(flattenModelsDraft(detached))))
      const own = choiceOf({ choices: resolveRoles({ draft: reloaded, models }), role })
      expect(ownsModel(own)).toBe(true)
      expect(own.ref).toEqual(inherited.ref)
      expect(own.effort).toBe(inherited.effort)
      expect(own.fast).toBe(inherited.fast)
      const followed = followedDraft({ draft: reloaded, role })
      const restored = choiceOf({ choices: resolveRoles({ draft: followed, models }), role })
      expect(ownsModel(restored)).toBe(false)
      expect(followed).toEqual(base)
      expect(base[roleKey(role)]?.model).toBe('')
    })
  }

  it('preserves the resolved value rather than a stale follower effort or fast value', () => {
    const models = optionsFixture()
    const base = {
      ...saved(),
      main: { model: MAIN_MODEL, effort: 'high', fast: true },
      subagents: { model: '', effort: 'low', fast: false },
    }
    const inherited = choiceOf({
      choices: resolveRoles({ draft: base, models }),
      role: EModelRole.Subagents,
    })
    expect(
      unfollowedDraft({ draft: base, role: EModelRole.Subagents, inherited }).subagents,
    ).toEqual({ model: MAIN_MODEL, effort: 'high', fast: true })
  })
})

describe('pickedModelDraft', () => {
  it('clamps the effort to the new model rungs and drops unsupported fast', () => {
    const models = optionsFixture()
    const base = { ...saved(), main: { model: MAIN_MODEL, effort: 'max', fast: true } }
    const choices = resolveRoles({ draft: base, models })
    const picked = pickedModelDraft({
      draft: base,
      role: EModelRole.Main,
      model: SMALL_MODEL,
      option: models.find((model) => model.id === SMALL_MODEL),
      inherited: choiceOf({ choices, role: EModelRole.Main }),
    })
    expect(picked.main).toEqual({ model: SMALL_MODEL, effort: 'medium', fast: false })
  })

  it('starts a follower from the model, effort and fast it inherited', () => {
    const models = optionsFixture()
    const base = { ...saved(), main: { model: MAIN_MODEL, effort: 'high', fast: true } }
    const choices = resolveRoles({ draft: base, models })
    const inherited = choiceOf({ choices, role: EModelRole.Subagents })
    expect(inherited.effort).toBe(EEffort.High)
    expect(inherited.fast).toBe(true)
    const picked = pickedModelDraft({
      draft: base,
      role: EModelRole.Subagents,
      model: MAIN_MODEL,
      option: models.find((model) => model.id === MAIN_MODEL),
      inherited,
    })
    expect(picked.subagents).toEqual({ model: MAIN_MODEL, effort: 'high', fast: true })
  })
})

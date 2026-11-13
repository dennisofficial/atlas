import { describe, expect, it } from 'bun:test'

import { EEffort, EModelRole, refKey } from '@dltech/atlas-core'

import { FALLBACK_MODEL, MAIN_MODEL, optionsFixture, STALE_MODEL } from './model-options-fixture'
import { choiceOf, resolveRoles, staleOwnerOf } from '../model-roles'
import { modelsDraftFrom } from '../models-settings'

const saved = () => modelsDraftFrom(new Map())

const teammate = 'agent-type:teammate'

describe('resolveRoles', () => {
  it('shows a follower the model, effort and fast it inherits', () => {
    const draft = { ...saved(), main: { model: MAIN_MODEL, effort: 'high', fast: true } }
    const choices = resolveRoles({ draft, models: optionsFixture() })
    const subagents = choiceOf({ choices, role: EModelRole.Subagents })
    expect(refKey(subagents.ref)).toBe(MAIN_MODEL)
    expect(subagents.effort).toBe(EEffort.High)
    expect(subagents.fast).toBe(true)
    expect(subagents.follows).toBe(EModelRole.Main)
    expect(subagents.stale).toBe(false)
  })

  it('lets an agent type follow subagents unless it has its own model', () => {
    const draft = { ...saved(), subagents: { model: MAIN_MODEL, effort: 'medium', fast: false } }
    const choices = resolveRoles({ draft, models: optionsFixture() })
    const builder = choiceOf({ choices, role: { agentType: 'builder' } })
    expect(refKey(builder.ref)).toBe(MAIN_MODEL)
    expect(builder.follows).toBe(EModelRole.Subagents)
    expect(draft[teammate]?.model).toBe('')
  })

  it('shows the fallback model for main when nothing is stored', () => {
    const choices = resolveRoles({ draft: saved(), models: optionsFixture() })
    expect(refKey(choiceOf({ choices, role: EModelRole.Main }).ref)).toBe(FALLBACK_MODEL)
  })
})

describe('staleOwnerOf', () => {
  it('names the first role in row order that owns an unreachable model', () => {
    const draft = {
      ...saved(),
      main: { model: STALE_MODEL, effort: '', fast: false },
    }
    const choices = resolveRoles({ draft, models: optionsFixture() })
    expect(choiceOf({ choices, role: EModelRole.Main }).stale).toBe(true)
    expect(staleOwnerOf(choices)?.role).toBe(EModelRole.Main)
  })

  it('leaves followers of a stale model without a warning of their own', () => {
    const draft = { ...saved(), main: { model: STALE_MODEL, effort: '', fast: false } }
    const choices = resolveRoles({ draft, models: optionsFixture() })
    for (const role of [EModelRole.Subagents, EModelRole.Quick] as const) {
      expect(choiceOf({ choices, role }).stale).toBe(false)
    }
    expect(staleOwnerOf(choices)?.role).toBe(EModelRole.Main)
  })

  it('reports no owner when every stored model is reachable', () => {
    const draft = { ...saved(), main: { model: MAIN_MODEL, effort: '', fast: false } }
    expect(staleOwnerOf(resolveRoles({ draft, models: optionsFixture() }))).toBeUndefined()
  })
})

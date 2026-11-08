import { describe, expect, it } from 'bun:test'

import {
  BUILT_IN_AGENT_ORDER,
  EAgentRole,
  EBuiltInAgentType,
  EEffort,
  EPreset,
  PRESETS,
} from '../../../fixtures/settings-agent'
import {
  BUILT_IN_EFFORT_KEYS,
  BUILT_IN_MODEL_KEYS,
  modelsChanges,
  modelsDraftFrom,
  TEAMMATE_EFFORT_KEY,
  TEAMMATE_MODEL_KEY,
} from '../models-settings'

describe('modelsDraftFrom', () => {
  it('reads teammate and built-in overrides as follow when unset', () => {
    const draft = modelsDraftFrom(new Map())
    expect(draft.teammate).toEqual({ model: 'auto' })
    for (const type of BUILT_IN_AGENT_ORDER) {
      expect(draft.builtIns[type]).toEqual({ model: 'auto' })
    }
  })

  it('maps stored agent-type keys onto their cards', () => {
    const draft = modelsDraftFrom(
      new Map([
        ['agents.type.teammate', 'anthropic/claude-opus-5'],
        ['agents.type.builder', 'openai/gpt-5-mini'],
        ['agents.type.reviewer', 'anthropic/claude-sonnet-5'],
      ]),
    )
    expect(draft.teammate.model).toBe('anthropic/claude-opus-5')
    expect(draft.builtIns[EBuiltInAgentType.Builder].model).toBe('openai/gpt-5-mini')
    expect(draft.builtIns[EBuiltInAgentType.Reviewer].model).toBe('anthropic/claude-sonnet-5')
  })

  it('reads the main role fast toggle, defaulting off', () => {
    expect(modelsDraftFrom(new Map()).roles[EAgentRole.Main].fast).toBe(false)
    expect(modelsDraftFrom(new Map([['model.fast', true]])).roles[EAgentRole.Main].fast).toBe(true)
    expect(modelsDraftFrom(new Map([['model.fast', true]])).roles[EAgentRole.Quick].fast).toBe(
      undefined,
    )
  })
})

describe('modelsDraftFrom effort', () => {
  it('reads inherit when no effort is stored, empty or unrecognised', () => {
    const draft = modelsDraftFrom(
      new Map([
        ['agents.subagentEffort', ''],
        [TEAMMATE_EFFORT_KEY, 'bogus'],
      ]),
    )
    expect(draft.roles[EAgentRole.Subagents].effort).toBeUndefined()
    expect(draft.teammate.effort).toBeUndefined()
    expect(draft.builtIns[EBuiltInAgentType.Builder].effort).toBeUndefined()
  })

  it('reads stored rungs for subagents, teammate and built-in types', () => {
    const draft = modelsDraftFrom(
      new Map([
        ['agents.subagentEffort', 'low'],
        [TEAMMATE_EFFORT_KEY, 'max'],
        [BUILT_IN_EFFORT_KEYS[EBuiltInAgentType.Explore], 'high'],
      ]),
    )
    expect(draft.roles[EAgentRole.Subagents].effort).toBe(EEffort.Low)
    expect(draft.teammate.effort).toBe(EEffort.Max)
    expect(draft.builtIns[EBuiltInAgentType.Explore].effort).toBe(EEffort.High)
    expect(draft.builtIns[EBuiltInAgentType.Builder].effort).toBeUndefined()
  })

  it('keeps the main agent defaulting to medium', () => {
    expect(modelsDraftFrom(new Map()).roles[EAgentRole.Main].effort).toBe(EEffort.Medium)
  })
})

describe('modelsChanges', () => {
  const saved = modelsDraftFrom(new Map())

  it('diffs the teammate model, with auto written back as empty', () => {
    const draft = { ...saved, teammate: { model: 'anthropic/claude-opus-5' } }
    expect(modelsChanges({ saved, draft })).toEqual({
      [TEAMMATE_MODEL_KEY]: 'anthropic/claude-opus-5',
    })
    const set = modelsDraftFrom(new Map([[TEAMMATE_MODEL_KEY, 'anthropic/claude-opus-5']]))
    expect(modelsChanges({ saved: set, draft: saved })).toEqual({
      [TEAMMATE_MODEL_KEY]: '',
    })
  })

  it('diffs a built-in sub-agent override without touching preset bookkeeping', () => {
    const draft = {
      ...saved,
      builtIns: {
        ...saved.builtIns,
        [EBuiltInAgentType.Builder]: { model: 'openai/gpt-5-mini' },
      },
    }
    expect(modelsChanges({ saved, draft })).toEqual({
      [BUILT_IN_MODEL_KEYS[EBuiltInAgentType.Builder]]: 'openai/gpt-5-mini',
    })
  })

  it('writes an empty string when a built-in override returns to follow', () => {
    const stored = new Map([[BUILT_IN_MODEL_KEYS[EBuiltInAgentType.Explore], 'openai/gpt-5']])
    const before = modelsDraftFrom(stored)
    const after = modelsDraftFrom(stored)
    after.builtIns[EBuiltInAgentType.Explore] = { model: 'auto' }
    expect(modelsChanges({ saved: before, draft: after })).toEqual({
      [BUILT_IN_MODEL_KEYS[EBuiltInAgentType.Explore]]: '',
    })
  })

  it('writes the preset marker once when both roles and overrides change', () => {
    const draft = {
      roles: PRESETS[EPreset.Thorough],
      teammate: { model: 'anthropic/claude-opus-5' },
      builtIns: saved.builtIns,
    }
    const changes = modelsChanges({ saved, draft })
    expect(changes['web.models.preset']).toBe('thorough')
    expect(changes[TEAMMATE_MODEL_KEY]).toBe('anthropic/claude-opus-5')
    expect(Object.keys(changes).filter((key) => key === 'web.models.preset')).toHaveLength(1)
  })

  it('writes the preset marker when only the effort rung changes', () => {
    const draft = {
      ...saved,
      roles: {
        ...saved.roles,
        [EAgentRole.Main]: { model: 'auto', effort: EEffort.High },
      },
    }
    expect(modelsChanges({ saved, draft })['web.models.preset']).toBe('custom')
  })

  it('writes model.fast as a boolean without touching the preset marker', () => {
    const draft = {
      ...saved,
      roles: {
        ...saved.roles,
        [EAgentRole.Main]: { ...saved.roles[EAgentRole.Main], fast: true },
      },
    }
    const changes = modelsChanges({ saved, draft })
    expect(changes['model.fast']).toBe(true)
    expect(changes['web.models.preset']).toBe('balanced')
  })

  it('writes a built-in effort rung and clears it back to an empty string', () => {
    const set = {
      ...saved,
      builtIns: {
        ...saved.builtIns,
        [EBuiltInAgentType.Reviewer]: { model: 'auto', effort: EEffort.High },
      },
    }
    const key = BUILT_IN_EFFORT_KEYS[EBuiltInAgentType.Reviewer]
    expect(modelsChanges({ saved, draft: set })).toEqual({ [key]: 'high' })
    expect(modelsChanges({ saved: set, draft: saved })).toEqual({ [key]: '' })
  })

  it('writes teammate and subagent inherit as an empty string', () => {
    const stored = modelsDraftFrom(
      new Map([
        [TEAMMATE_EFFORT_KEY, 'low'],
        ['agents.subagentEffort', 'low'],
      ]),
    )
    const draft = {
      ...stored,
      teammate: { model: 'auto' },
      roles: { ...stored.roles, [EAgentRole.Subagents]: { model: 'auto' } },
    }
    const changes = modelsChanges({ saved: stored, draft })
    expect(changes[TEAMMATE_EFFORT_KEY]).toBe('')
    expect(changes['agents.subagentEffort']).toBe('')
  })

  it('leaves the preset marker alone for a subagent effort-only change', () => {
    const draft = {
      ...saved,
      roles: {
        ...saved.roles,
        [EAgentRole.Subagents]: { model: 'auto', effort: EEffort.Low },
      },
    }
    const changes = modelsChanges({ saved, draft })
    expect(changes['agents.subagentEffort']).toBe('low')
    expect(changes['web.models.preset']).toBeUndefined()
  })
})

import { describe, expect, it } from 'bun:test'

import { EModelRole, parentOf, roleKey, roleKeysOf } from '../roles'

describe('the model role graph', () => {
  it('names a model, an effort and a fast key for every role', () => {
    expect(roleKeysOf(EModelRole.Main)).toEqual({
      model: 'model.id',
      effort: 'model.effort',
      fast: 'model.fast',
    })
    expect(roleKeysOf(EModelRole.Subagents)).toEqual({
      model: 'agents.subagentModel',
      effort: 'agents.subagentEffort',
      fast: 'agents.subagentFast',
    })
    expect(roleKeysOf(EModelRole.Quick)).toEqual({
      model: 'model.quickModel',
      effort: 'model.quickEffort',
      fast: 'model.quickFast',
    })
    expect(roleKeysOf(EModelRole.Compaction)).toEqual({
      model: 'model.compactionModel',
      effort: 'model.compactionEffort',
      fast: 'model.compactionFast',
    })
    expect(roleKeysOf({ agentType: 'builder' })).toEqual({
      model: 'agents.type.builder',
      effort: 'agents.type.builder.effort',
      fast: 'agents.type.builder.fast',
    })
  })

  it('hangs every role under main except an ordinary agent type', () => {
    expect(parentOf(EModelRole.Main)).toBeUndefined()
    expect(parentOf(EModelRole.Subagents)).toBe(EModelRole.Main)
    expect(parentOf(EModelRole.Quick)).toBe(EModelRole.Main)
    expect(parentOf(EModelRole.Compaction)).toBe(EModelRole.Main)
    expect(parentOf({ agentType: 'teammate' })).toBe(EModelRole.Main)
    expect(parentOf({ agentType: 'builder' })).toBe(EModelRole.Subagents)
  })

  it('keys an agent type apart from the named roles', () => {
    expect(roleKey(EModelRole.Main)).toBe('main')
    expect(roleKey({ agentType: 'builder' })).toBe('agent-type:builder')
    expect(roleKey({ agentType: 'builder' })).not.toBe(roleKey(EModelRole.Subagents))
  })
})

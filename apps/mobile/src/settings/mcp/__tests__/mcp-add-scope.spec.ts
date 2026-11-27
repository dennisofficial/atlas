import { describe, expect, it } from 'bun:test'

import { mcpAddParamsOf, mcpScopeOfParams } from '../mcp-add-scope'

describe('mcpScopeOfParams', () => {
  it('reads the scope the add sheet was opened for', () => {
    expect(mcpScopeOfParams({ scope: 'user' })).toEqual({ kind: 'user' })
    expect(mcpScopeOfParams({ scope: 'project', id: 'proj_1' })).toEqual({
      kind: 'project',
      id: 'proj_1',
    })
    expect(mcpScopeOfParams({ scope: 'group', id: 'grp_1' })).toEqual({
      kind: 'group',
      id: 'grp_1',
    })
  })

  it('falls back to the personal scope when the params are incomplete', () => {
    expect(mcpScopeOfParams({})).toEqual({ kind: 'user' })
    expect(mcpScopeOfParams({ scope: 'project' })).toEqual({ kind: 'user' })
    expect(mcpScopeOfParams({ scope: 'group' })).toEqual({ kind: 'user' })
  })
})

describe('mcpAddParamsOf', () => {
  it('round-trips a scope through the add sheet', () => {
    for (const scope of [
      { kind: 'user' as const },
      { kind: 'project' as const, id: 'proj_1' },
      { kind: 'group' as const, id: 'grp_1' },
    ])
      expect(mcpScopeOfParams(mcpAddParamsOf(scope))).toEqual(scope)
  })
})

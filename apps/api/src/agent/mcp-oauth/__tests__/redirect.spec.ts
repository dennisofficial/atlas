import { describe, expect, it } from 'bun:test'

import { returnPathOf } from '../redirect'

describe('returnPathOf', () => {
  it('names the session screen', () => {
    expect(returnPathOf({ kind: 'session', id: 'ses_1' })).toBe('/sessions/ses_1')
  })

  it('names the user settings page', () => {
    expect(returnPathOf({ kind: 'settings', scope: 'user' })).toBe('/settings/integrations')
  })

  it('names a project MCP settings page', () => {
    expect(returnPathOf({ kind: 'settings', scope: 'project', id: 'proj_1' })).toBe(
      '/projects/proj_1/settings/mcp',
    )
  })

  it('escapes an id rather than letting it move the path', () => {
    expect(returnPathOf({ kind: 'session', id: '../settings' })).toBe('/sessions/..%2Fsettings')
  })

  it('names a group MCP settings page', () => {
    expect(returnPathOf({ kind: 'settings', scope: 'group', id: 'grp_1' })).toBe(
      '/groups/grp_1/settings/mcp',
    )
  })
})

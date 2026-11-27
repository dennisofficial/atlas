import { describe, expect, it } from 'bun:test'

import { EMcpServerScope, EMcpTransportKind } from '@dltech/atlas-wire/web'

import { mcpOauthScreenOfScope, mcpServersInputOf, mcpServerPutInputOf } from '../scope'

describe('mcpServersInputOf', () => {
  it('names the layer a server list is read from', () => {
    expect(mcpServersInputOf({ kind: 'user' })).toEqual({ scope: EMcpServerScope.Personal })
    expect(mcpServersInputOf({ kind: 'project', id: 'proj_1' })).toEqual({
      scope: EMcpServerScope.Project,
      projectId: 'proj_1',
    })
    expect(mcpServersInputOf({ kind: 'group', id: 'grp_1' })).toEqual({
      scope: EMcpServerScope.Group,
      groupId: 'grp_1',
    })
  })
})

describe('mcpServerPutInputOf', () => {
  it('writes the server into the layer and scope that asked for it', () => {
    expect(
      mcpServerPutInputOf({
        scope: { kind: 'group', id: 'grp_1' },
        draft: {
          id: 'ios-settings-check',
          kind: EMcpTransportKind.Http,
          target: 'https://example.com/mcp',
          extra: '',
          proxy: false,
        },
      }),
    ).toEqual({
      scope: EMcpServerScope.Group,
      groupId: 'grp_1',
      name: 'ios-settings-check',
      transport: { kind: EMcpTransportKind.Http, url: 'https://example.com/mcp' },
    })
  })
})

describe('mcpOauthScreenOfScope', () => {
  it('returns the sign-in to the screen that started it', () => {
    expect(mcpOauthScreenOfScope({ kind: 'user' })).toEqual({ kind: 'settings', scope: 'user' })
    expect(mcpOauthScreenOfScope({ kind: 'project', id: 'proj_1' })).toEqual({
      kind: 'settings',
      scope: 'project',
      id: 'proj_1',
    })
    expect(mcpOauthScreenOfScope({ kind: 'group', id: 'grp_1' })).toEqual({
      kind: 'settings',
      scope: 'group',
      id: 'grp_1',
    })
  })
})

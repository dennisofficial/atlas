import { describe, expect, it } from 'bun:test'
import { EAccessScope, EMcpServerScope, ESkillScope } from '@dltech/atlas-wire/web'

import { accessScopeOf, mcpScopeOf, sectionHrefOf, skillTargetOf } from '../settings-scope'

const PROJECT = { kind: 'project', projectId: 'prj-1' } as const
const GROUP = { kind: 'group', groupId: 'grp-1' } as const

describe('settings scope', () => {
  it('maps a scope to the access-grants scope', () => {
    expect(accessScopeOf(PROJECT)).toEqual({ kind: EAccessScope.Project, projectId: 'prj-1' })
    expect(accessScopeOf(GROUP)).toEqual({ kind: EAccessScope.Group, groupId: 'grp-1' })
  })

  it('maps a scope to the MCP server scope', () => {
    expect(mcpScopeOf(PROJECT)).toEqual({
      scope: EMcpServerScope.Project,
      projectId: 'prj-1',
    })
    expect(mcpScopeOf(GROUP)).toEqual({ scope: EMcpServerScope.Group, groupId: 'grp-1' })
  })

  it('maps a scope to the skills target', () => {
    expect(skillTargetOf(PROJECT)).toEqual({ scope: ESkillScope.Project, projectId: 'prj-1' })
    expect(skillTargetOf(GROUP)).toEqual({ scope: ESkillScope.Group, groupId: 'grp-1' })
  })

  it('builds the section href for each scope', () => {
    expect(sectionHrefOf({ scope: PROJECT, section: 'access' })).toBe(
      '/projects/prj-1/settings/access',
    )
    expect(sectionHrefOf({ scope: GROUP, section: 'access' })).toBe('/groups/grp-1/settings/access')
  })
})

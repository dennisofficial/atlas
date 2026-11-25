import { describe, expect, it } from 'bun:test'

import { EProjectSettingsSection } from '@/features/project-settings/project-settings-nav'

import { GROUP_NAV, groupSectionOfPath, hrefOfGroupSection } from '../group-settings-nav'

describe('group settings nav', () => {
  it('offers every inheritable section and no project-only one', () => {
    expect(GROUP_NAV.map((item) => item.section)).toEqual([
      EProjectSettingsSection.Overview,
      EProjectSettingsSection.Sandbox,
      EProjectSettingsSection.Access,
      EProjectSettingsSection.Skills,
      EProjectSettingsSection.Mcp,
    ])
    expect(GROUP_NAV.map((item) => item.section)).not.toContain(
      EProjectSettingsSection.PullRequests,
    )
  })

  it('resolves a section from a group settings path', () => {
    expect(groupSectionOfPath('/groups/grp-1/settings/access')).toBe(EProjectSettingsSection.Access)
    expect(groupSectionOfPath('/groups/grp-1/settings')).toBeNull()
    expect(groupSectionOfPath('/projects/prj-1/settings/access')).toBeNull()
  })

  it('builds the href for a section', () => {
    expect(hrefOfGroupSection({ groupId: 'grp-1', section: EProjectSettingsSection.Mcp })).toBe(
      '/groups/grp-1/settings/mcp',
    )
  })
})

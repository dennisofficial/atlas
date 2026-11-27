import { describe, expect, it } from 'bun:test'

import { EGroupSettingsSection, GROUP_SECTIONS } from '../group-sections'
import { EProjectSettingsSection, PROJECT_SECTIONS } from '../project-sections'
import { ESettingsPage, SETTINGS_NAV, filterNav, labelOfPage } from '../settings-pages'

const ALL_PAGES = Object.values(ESettingsPage)
const NAV_PAGES = SETTINGS_NAV.flatMap((group) => group.items.map((item) => item.page))

describe('settings pages', () => {
  it('lists every page exactly once', () => {
    expect([...NAV_PAGES].sort()).toEqual([...ALL_PAGES].sort())
  })

  it('labels every page', () => {
    for (const page of ALL_PAGES) {
      expect(labelOfPage(page)).not.toBe(page)
    }
  })

  it('filters a nav item by its label or its group label', () => {
    const memory = filterNav({ groups: SETTINGS_NAV, query: 'memory' })
    expect(memory.flatMap((group) => group.items.map((item) => item.page))).toEqual([
      ESettingsPage.Memory,
    ])
    const library = filterNav({ groups: SETTINGS_NAV, query: 'library' })
    expect(library.flatMap((group) => group.items.map((item) => item.page))).toEqual([
      ESettingsPage.Access,
      ESettingsPage.Groups,
    ])
    expect(filterNav({ groups: SETTINGS_NAV, query: 'zzz' })).toEqual([])
    expect(filterNav({ groups: SETTINGS_NAV, query: '  ' })).toEqual(SETTINGS_NAV)
  })

  it('keeps fields a surface adds to a nav item', () => {
    const groups = [{ items: [{ page: ESettingsPage.Account, label: 'Account', icon: 'user' }] }]
    expect(filterNav({ groups, query: 'account' })[0]?.items[0]?.icon).toBe('user')
  })
})

describe('project sections', () => {
  it('orders every section', () => {
    expect(PROJECT_SECTIONS.map((item) => item.section)).toEqual(
      Object.values(EProjectSettingsSection),
    )
  })
})

describe('group sections', () => {
  it('inherits the project sections and adds instructions', () => {
    expect(GROUP_SECTIONS.map((item) => item.section)).toEqual([
      EProjectSettingsSection.Overview,
      EGroupSettingsSection.Instructions,
      EProjectSettingsSection.Sandbox,
      EProjectSettingsSection.Access,
      EProjectSettingsSection.Skills,
      EProjectSettingsSection.Mcp,
    ])
  })

  it('leaves out the project-only pull requests section', () => {
    expect(GROUP_SECTIONS.map((item) => item.section)).not.toContain(
      EProjectSettingsSection.PullRequests,
    )
  })
})

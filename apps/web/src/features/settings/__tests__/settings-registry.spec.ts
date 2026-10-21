import { describe, expect, it } from 'bun:test'

import {
  ESettingsPage,
  ESettingsScope,
  PERSONAL_NAV,
  WORKSPACE_NAV,
  filterNav,
  firstPageOf,
  hrefOfPage,
  parseSettingsPage,
  scopeOfPage,
} from '../settings-nav'
import { EPageStatus, SETTINGS_PAGE_STATUS } from '../status/page-status'

const ALL_PAGES = Object.values(ESettingsPage)
const NAV_PAGES = [...PERSONAL_NAV, ...WORKSPACE_NAV].flatMap((group) =>
  group.items.map((item) => item.page),
)

describe('settings page registry', () => {
  it('gives every page exactly one nav item', () => {
    expect([...NAV_PAGES].sort()).toEqual([...ALL_PAGES].sort())
  })

  it('gives every page a status', () => {
    for (const page of ALL_PAGES) {
      expect(Object.values(EPageStatus)).toContain(SETTINGS_PAGE_STATUS[page].status)
    }
  })

  it('resolves the scope of workspace and personal pages', () => {
    expect(scopeOfPage(ESettingsPage.WorkspaceMembers)).toBe(ESettingsScope.Workspace)
    expect(scopeOfPage(ESettingsPage.Memory)).toBe(ESettingsScope.Personal)
    expect(scopeOfPage(firstPageOf(ESettingsScope.Workspace))).toBe(ESettingsScope.Workspace)
  })

  it('filters nav items by label or group label', () => {
    const memory = filterNav({ groups: PERSONAL_NAV, query: 'memory' })
    expect(memory.flatMap((group) => group.items.map((item) => item.page))).toEqual([
      ESettingsPage.Memory,
    ])
    const usage = filterNav({ groups: PERSONAL_NAV, query: 'usage' })
    expect(usage.flatMap((group) => group.items)).toHaveLength(2)
    expect(filterNav({ groups: PERSONAL_NAV, query: 'zzz' })).toEqual([])
  })
})

describe('settings route params', () => {
  it('accepts every page slug', () => {
    for (const page of ALL_PAGES) {
      expect(parseSettingsPage(page)).toBe(page)
    }
  })

  it('rejects unknown values', () => {
    expect(parseSettingsPage('nope')).toBeNull()
    expect(parseSettingsPage('')).toBeNull()
    expect(parseSettingsPage('ACCOUNT')).toBeNull()
    expect(parseSettingsPage('constructor')).toBeNull()
  })

  it('builds hrefs that round-trip through the parser', () => {
    expect(hrefOfPage(ESettingsPage.UsageModels)).toBe('/settings/usage-models')
  })
})

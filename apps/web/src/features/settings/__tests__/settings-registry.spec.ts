import { describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import {
  ESettingsPage,
  ESettingsScope,
  PERSONAL_NAV,
  WORKSPACE_NAV,
  filterNav,
  firstPageOf,
  hrefOfPage,
  scopeOfPage,
  settingsPageOfPath,
} from '../settings-nav'
import { EPageStatus, SETTINGS_PAGE_STATUS } from '../status/page-status'

const SETTINGS_APP_DIR = join(import.meta.dir, '../../../app/(private)/settings')
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
    expect(usage.flatMap((group) => group.items.map((item) => item.page))).toEqual([
      ESettingsPage.UsageSandboxes,
    ])
    expect(filterNav({ groups: PERSONAL_NAV, query: 'zzz' })).toEqual([])
  })
})

describe('settings route paths', () => {
  it('resolves every page from its path', () => {
    for (const page of ALL_PAGES) {
      expect(settingsPageOfPath(hrefOfPage(page))).toBe(page)
    }
  })

  it('rejects unknown paths', () => {
    expect(settingsPageOfPath('/settings/nope')).toBeNull()
    expect(settingsPageOfPath('/settings/ACCOUNT')).toBeNull()
    expect(settingsPageOfPath('/settings/constructor')).toBeNull()
    expect(settingsPageOfPath('/settings/')).toBeNull()
    expect(settingsPageOfPath('/settings')).toBeNull()
    expect(settingsPageOfPath('/projects/x/settings/account')).toBeNull()
  })

  it('ignores trailing segments', () => {
    expect(settingsPageOfPath('/settings/account')).toBe(ESettingsPage.Account)
    expect(settingsPageOfPath('/settings/account/')).toBe(ESettingsPage.Account)
  })

  it('builds hrefs for slugged pages', () => {
    expect(hrefOfPage(ESettingsPage.UsageSandboxes)).toBe('/settings/usage-sandboxes')
  })

  it('has a route folder with a page for every page', () => {
    for (const page of ALL_PAGES) {
      expect(existsSync(join(SETTINGS_APP_DIR, page, 'page.tsx'))).toBe(true)
    }
  })
})

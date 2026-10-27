import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import {
  ESettingsPage,
  ESettingsScope,
  PERSONAL_NAV,
  WORKSPACE_NAV,
  firstPageOf,
  hrefOfPage,
  navForScope,
  scopeOfPage,
  settingsPageOfPath,
} from '../settings-nav'

const SETTINGS_APP_DIR = join(import.meta.dir, '../../../app/(private)/settings')

const WORKSPACE_PAGES = [
  ESettingsPage.WorkspaceGeneral,
  ESettingsPage.WorkspaceMembers,
  ESettingsPage.WorkspaceSecrets,
  ESettingsPage.WorkspaceMcp,
]

describe('settings routes', () => {
  test('every page round-trips through its href', () => {
    for (const page of Object.values(ESettingsPage)) {
      expect(settingsPageOfPath(hrefOfPage(page))).toBe(page)
    }
  })

  test('parked pages are routable but not in the personal nav', () => {
    const navPages = PERSONAL_NAV.flatMap((group) => group.items.map((item) => item.page))
    expect(settingsPageOfPath('/settings/notifications')).toBe(ESettingsPage.Notifications)
    expect(settingsPageOfPath('/settings/security')).toBe(ESettingsPage.Security)
    expect(navPages).not.toContain(ESettingsPage.Notifications)
    expect(navPages).not.toContain(ESettingsPage.Security)
  })

  test('unknown paths resolve to null', () => {
    expect(settingsPageOfPath('/settings/nope')).toBeNull()
    expect(settingsPageOfPath('/settings/')).toBeNull()
    expect(settingsPageOfPath('/settings')).toBeNull()
    expect(settingsPageOfPath('/settings/account/extra')).toBeNull()
    expect(settingsPageOfPath('/settings/github')).toBeNull()
    expect(settingsPageOfPath('/threads/new')).toBeNull()
    expect(settingsPageOfPath(null)).toBeNull()
  })

  test('every page has a route folder', () => {
    for (const page of Object.values(ESettingsPage)) {
      expect(existsSync(join(SETTINGS_APP_DIR, page, 'page.tsx'))).toBe(true)
    }
  })
})

describe('settings scopes', () => {
  test('workspace pages belong to the workspace scope', () => {
    for (const page of WORKSPACE_PAGES) {
      expect(scopeOfPage(page)).toBe(ESettingsScope.Workspace)
    }
    expect(scopeOfPage(ESettingsPage.Account)).toBe(ESettingsScope.Personal)
    expect(scopeOfPage(ESettingsPage.Notifications)).toBe(ESettingsScope.Personal)
  })

  test('each scope opens on its first nav item', () => {
    expect(firstPageOf(ESettingsScope.Personal)).toBe(ESettingsPage.Account)
    expect(firstPageOf(ESettingsScope.Workspace)).toBe(ESettingsPage.WorkspaceGeneral)
  })

  test('navForScope returns the matching groups', () => {
    expect(navForScope(ESettingsScope.Personal)).toBe(PERSONAL_NAV)
    expect(navForScope(ESettingsScope.Workspace)).toBe(WORKSPACE_NAV)
  })
})

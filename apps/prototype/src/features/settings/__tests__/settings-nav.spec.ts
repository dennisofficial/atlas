import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { ESettingsPage, SETTINGS_NAV, hrefOfPage, settingsPageOfPath } from '../settings-nav'

const SETTINGS_APP_DIR = join(import.meta.dir, '../../../app/(private)/settings')

describe('settings routes', () => {
  test('every page round-trips through its href', () => {
    for (const page of Object.values(ESettingsPage)) {
      expect(settingsPageOfPath(hrefOfPage(page))).toBe(page)
    }
  })

  test('parked pages are routable but not in the personal nav', () => {
    const navPages = SETTINGS_NAV.flatMap((group) => group.items.map((item) => item.page))
    expect(settingsPageOfPath('/settings/notifications')).toBe(ESettingsPage.Notifications)
    expect(settingsPageOfPath('/settings/security')).toBe(ESettingsPage.Security)
    expect(navPages).not.toContain(ESettingsPage.Notifications)
    expect(navPages).not.toContain(ESettingsPage.Security)
  })

  test('workspace routes no longer exist', () => {
    expect(settingsPageOfPath('/settings/workspace-general')).toBeNull()
    expect(settingsPageOfPath('/settings/workspace-members')).toBeNull()
    expect(settingsPageOfPath('/settings/workspace-secrets')).toBeNull()
    expect(settingsPageOfPath('/settings/workspace-mcp')).toBeNull()
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

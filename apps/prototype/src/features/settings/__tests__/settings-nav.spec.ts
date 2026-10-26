import { describe, expect, test } from 'bun:test'

import { PROTO_SAMPLES } from '../../../proto/samples'
import { ESettingsPage, PERSONAL_NAV, hrefOfPage, parseSettingsPage } from '../settings-nav'

describe('settings routes', () => {
  test('every page round-trips through its href', () => {
    for (const page of Object.values(ESettingsPage)) {
      const slug = hrefOfPage(page).replace('/settings/', '')
      expect(parseSettingsPage(slug)).toBe(page)
    }
  })

  test('parked pages are routable but not in the nav', () => {
    const navPages = PERSONAL_NAV.flatMap((group) => group.items.map((item) => item.page))
    expect(parseSettingsPage('notifications')).toBe(ESettingsPage.Notifications)
    expect(parseSettingsPage('security')).toBe(ESettingsPage.Security)
    expect(navPages).not.toContain(ESettingsPage.Notifications)
    expect(navPages).not.toContain(ESettingsPage.Security)
  })

  test('unknown slugs are rejected', () => {
    expect(parseSettingsPage('nope')).toBeNull()
    expect(parseSettingsPage('')).toBeNull()
  })

  test('every settings sample parses', () => {
    const samples = PROTO_SAMPLES['/settings/[page]'] ?? []
    for (const sample of samples) {
      expect(parseSettingsPage(sample.path.replace('/settings/', ''))).not.toBeNull()
    }
  })
})

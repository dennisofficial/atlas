import {
  EGroupSettingsSection,
  EProjectSettingsSection,
  ESettingsPage,
  GROUP_SECTIONS,
  PROJECT_SECTIONS,
} from '@dltech/atlas-client/settings'
import { describe, expect, it } from 'bun:test'

import {
  IOS_GROUP_SECTION_ROUTES,
  IOS_PENDING_GROUP_SECTIONS,
  IOS_PENDING_PAGES,
  IOS_PENDING_PROJECT_SECTIONS,
  IOS_PROJECT_SECTION_ROUTES,
  IOS_SETTINGS_ROUTES,
  SETTINGS_STACK_SCREENS,
  routedGroupSections,
  routedProjectSections,
} from '../settings-routes'

const isRoutedOrPending = (isRouted: boolean, isPending: boolean): boolean => isRouted !== isPending

describe('ios settings pages', () => {
  it('routes or pends every page, never both', () => {
    for (const page of Object.values(ESettingsPage)) {
      const routed = IOS_SETTINGS_ROUTES[page] !== undefined
      expect(isRoutedOrPending(routed, IOS_PENDING_PAGES.has(page))).toBe(true)
    }
  })

  it('routes notifications and its time-zone screen', () => {
    expect(IOS_SETTINGS_ROUTES[ESettingsPage.Notifications]).toBe('/settings/notifications')
    expect(IOS_PENDING_PAGES.has(ESettingsPage.Notifications)).toBe(false)
    expect(SETTINGS_STACK_SCREENS).toContainEqual({
      name: 'settings/notifications-timezone',
      title: 'Time zone',
    })
  })

  it('keeps no pending page that does not exist', () => {
    for (const page of IOS_PENDING_PAGES) expect(Object.values(ESettingsPage)).toContain(page)
  })
})

describe('ios project sections', () => {
  it('routes or pends every section, never both', () => {
    for (const { section } of PROJECT_SECTIONS) {
      const routed = IOS_PROJECT_SECTION_ROUTES[section] !== undefined
      expect(isRoutedOrPending(routed, IOS_PENDING_PROJECT_SECTIONS.has(section))).toBe(true)
    }
  })

  it('routes overview, sandbox and pull requests, in nav order', () => {
    expect(routedProjectSections().map((item) => item.section)).toEqual([
      EProjectSettingsSection.Overview,
      EProjectSettingsSection.Sandbox,
      EProjectSettingsSection.PullRequests,
    ])
  })
})

describe('ios group sections', () => {
  it('routes or pends every section, never both', () => {
    for (const { section } of GROUP_SECTIONS) {
      const routed = IOS_GROUP_SECTION_ROUTES[section] !== undefined
      expect(isRoutedOrPending(routed, IOS_PENDING_GROUP_SECTIONS.has(section))).toBe(true)
    }
  })

  it('routes group overview, instructions and sandbox', () => {
    expect(IOS_PENDING_GROUP_SECTIONS.has(EGroupSettingsSection.Instructions)).toBe(false)
    expect(routedGroupSections().map((item) => item.section)).toEqual([
      EProjectSettingsSection.Overview,
      EGroupSettingsSection.Instructions,
      EProjectSettingsSection.Sandbox,
    ])
  })
})

describe('settings stack screens', () => {
  it('names every screen once with a title', () => {
    const names = SETTINGS_STACK_SCREENS.map((screen) => screen.name)
    expect(new Set(names).size).toBe(names.length)
    for (const screen of SETTINGS_STACK_SCREENS) expect(screen.title.length).toBeGreaterThan(0)
  })
})

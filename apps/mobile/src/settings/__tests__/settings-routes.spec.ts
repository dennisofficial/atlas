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

  it('routes overview first', () => {
    expect(routedProjectSections().map((item) => item.section)).toEqual([
      EProjectSettingsSection.Overview,
      EProjectSettingsSection.Skills,
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

  it('routes the group instructions and skills, and pends the rest', () => {
    expect(IOS_PENDING_GROUP_SECTIONS.has(EGroupSettingsSection.Instructions)).toBe(false)
    expect(routedGroupSections().map((item) => item.section)).toEqual([
      EGroupSettingsSection.Instructions,
      EProjectSettingsSection.Skills,
    ])
  })
})

describe('settings stack screens', () => {
  it('names every screen once with a title', () => {
    const names = SETTINGS_STACK_SCREENS.map((screen) => screen.name)
    expect(new Set(names).size).toBe(names.length)
    for (const screen of SETTINGS_STACK_SCREENS) expect(screen.title.length).toBeGreaterThan(0)
  })

  it('counts both bar buttons of the skills list screens in the title width', () => {
    const skillsLists = SETTINGS_STACK_SCREENS.filter((screen) => screen.name.endsWith('/skills'))
    expect(skillsLists.length).toBe(3)
    for (const screen of skillsLists) expect(screen.titleButtons).toBe(2)
  })
})

import {
  EGroupSettingsSection,
  EProjectSettingsSection,
  ESettingsPage,
  GROUP_SECTIONS,
  PROJECT_SECTIONS,
} from '@dltech/atlas-client/settings'
import { describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

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

  it('keeps the model, agent and appearance pages routed beside notifications', () => {
    const pages = [
      ESettingsPage.ModelsEffort,
      ESettingsPage.Agent,
      ESettingsPage.Quality,
      ESettingsPage.Experimental,
      ESettingsPage.Appearance,
      ESettingsPage.Notifications,
    ]
    for (const page of pages) {
      const route = IOS_SETTINGS_ROUTES[page]
      expect(route).toBeDefined()
      expect(IOS_PENDING_PAGES.has(page)).toBe(false)
      expect(SETTINGS_STACK_SCREENS.some((screen) => `/${screen.name}` === route)).toBe(true)
    }
  })

  it('routes Access at all scopes with no settings pages left pending', () => {
    expect(IOS_SETTINGS_ROUTES[ESettingsPage.Access]).toBe('/settings/access')
    expect(IOS_PROJECT_SECTION_ROUTES[EProjectSettingsSection.Access]?.({ id: 'p /1' })).toBe(
      '/project-settings/p%20%2F1/access',
    )
    expect(IOS_GROUP_SECTION_ROUTES[EProjectSettingsSection.Access]?.({ id: 'g /1' })).toBe(
      '/group-settings/g%20%2F1/access',
    )
    expect(
      IOS_PENDING_PAGES.size + IOS_PENDING_PROJECT_SECTIONS.size + IOS_PENDING_GROUP_SECTIONS.size,
    ).toBe(0)
    expect(
      SETTINGS_STACK_SCREENS.find((screen) => screen.name === 'settings/access-form')?.sheet,
    ).toBeDefined()
    expect(
      SETTINGS_STACK_SCREENS.find((screen) => screen.name === 'settings/access-file')?.sheet,
    ).toBeDefined()
    const lists = SETTINGS_STACK_SCREENS.filter((screen) => screen.name.endsWith('/access'))
    expect(lists).toHaveLength(3)
    for (const screen of lists) expect(screen.titleButtons).toBe(2)
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

  it('routes overview, sandbox, skills, mcp and pull requests in nav order', () => {
    expect(routedProjectSections().map((item) => item.section)).toEqual([
      EProjectSettingsSection.Overview,
      EProjectSettingsSection.Sandbox,
      EProjectSettingsSection.Access,
      EProjectSettingsSection.Skills,
      EProjectSettingsSection.Mcp,
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

  it('routes group overview, instructions, sandbox, skills and mcp in nav order', () => {
    expect(IOS_PENDING_GROUP_SECTIONS.has(EGroupSettingsSection.Instructions)).toBe(false)
    expect(routedGroupSections().map((item) => item.section)).toEqual([
      EProjectSettingsSection.Overview,
      EGroupSettingsSection.Instructions,
      EProjectSettingsSection.Sandbox,
      EProjectSettingsSection.Access,
      EProjectSettingsSection.Skills,
      EProjectSettingsSection.Mcp,
    ])
  })
})

describe('settings stack screens', () => {
  it('names every screen once with a title', () => {
    const names = SETTINGS_STACK_SCREENS.map((screen) => screen.name)
    expect(new Set(names).size).toBe(names.length)
    for (const screen of SETTINGS_STACK_SCREENS) expect(screen.title.length).toBeGreaterThan(0)
  })

  it('pushes the model role editor with a default title', () => {
    expect(SETTINGS_STACK_SCREENS.find((screen) => screen.name === 'settings/model-role')).toEqual({
      name: 'settings/model-role',
      title: 'Model',
    })
  })

  it('counts both bar buttons of the skills list screens in the title width', () => {
    const skillsLists = SETTINGS_STACK_SCREENS.filter((screen) => screen.name.endsWith('/skills'))
    expect(skillsLists.length).toBe(3)
    for (const screen of skillsLists) expect(screen.titleButtons).toBe(2)
  })

  it('registers the repository picker and memory selection bar', () => {
    expect(SETTINGS_STACK_SCREENS).toContainEqual({
      name: 'project-settings/[projectId]/repository-picker',
      title: 'Repository',
    })
    expect(SETTINGS_STACK_SCREENS).toContainEqual({
      name: 'settings/memory',
      title: 'Memory',
      titleButtons: 2,
    })
  })

  it('names a route file that exists', () => {
    for (const screen of SETTINGS_STACK_SCREENS) {
      const file = resolve(import.meta.dir, '..', '..', 'app', '(app)', `${screen.name}.tsx`)
      expect(existsSync(file)).toBe(true)
    }
  })
})

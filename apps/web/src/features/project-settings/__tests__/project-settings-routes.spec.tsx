import { describe, expect, it } from 'bun:test'

import { PROJECT_SECTION_STATUS, EPageStatus } from '@/features/settings/status/page-status'

import {
  EProjectSettingsSection,
  PROJECT_NAV,
  hrefOfProjectSection,
  parseProjectSection,
} from '../project-settings-nav'
import { PROJECT_SECTION_PAGES } from '../project-settings-pages'

const ALL_SECTIONS = Object.values(EProjectSettingsSection)

describe('project settings sections', () => {
  it('maps every section to a nav item, a page component and a status', () => {
    expect(PROJECT_NAV.map((item) => item.section).sort()).toEqual([...ALL_SECTIONS].sort())
    for (const section of ALL_SECTIONS) {
      expect(typeof PROJECT_SECTION_PAGES[section]).toBe('function')
      expect(Object.values(EPageStatus)).toContain(PROJECT_SECTION_STATUS[section].status)
    }
  })

  it('parses known sections and rejects the rest', () => {
    for (const section of ALL_SECTIONS) {
      expect(parseProjectSection(section)).toBe(section)
    }
    expect(parseProjectSection('billing')).toBeNull()
    expect(parseProjectSection('')).toBeNull()
  })

  it('builds hrefs with an encoded project id', () => {
    expect(
      hrefOfProjectSection({ projectId: 'a b', section: EProjectSettingsSection.Mcp }),
    ).toBe('/projects/a%20b/settings/mcp')
  })
})

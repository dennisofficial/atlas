import { describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { PROJECT_SECTION_STATUS, EPageStatus } from '@/features/settings/status/page-status'

import {
  EProjectSettingsSection,
  PROJECT_NAV,
  hrefOfProjectSection,
  projectSectionOfPath,
} from '../project-settings-nav'

const PROJECT_APP_DIR = join(
  import.meta.dir,
  '../../../app/(private)/projects/[projectId]/settings',
)
const ALL_SECTIONS = Object.values(EProjectSettingsSection)

describe('project settings sections', () => {
  it('maps every section to a nav item, a route folder and a status', () => {
    expect(PROJECT_NAV.map((item) => item.section).sort()).toEqual([...ALL_SECTIONS].sort())
    for (const section of ALL_SECTIONS) {
      expect(existsSync(join(PROJECT_APP_DIR, section, 'page.tsx'))).toBe(true)
      expect(Object.values(EPageStatus)).toContain(PROJECT_SECTION_STATUS[section].status)
    }
  })

  it('resolves known sections from the path and rejects the rest', () => {
    for (const section of ALL_SECTIONS) {
      expect(projectSectionOfPath(`/projects/x/settings/${section}`)).toBe(section)
    }
    expect(projectSectionOfPath('/projects/x/settings/mcp')).toBe(EProjectSettingsSection.Mcp)
    expect(projectSectionOfPath('/projects/x/settings/billing')).toBeNull()
    expect(projectSectionOfPath('/projects/x/settings/constructor')).toBeNull()
    expect(projectSectionOfPath('/projects/x/settings')).toBeNull()
    expect(projectSectionOfPath('/settings/mcp')).toBeNull()
  })

  it('builds hrefs with an encoded project id', () => {
    expect(hrefOfProjectSection({ projectId: 'a b', section: EProjectSettingsSection.Mcp })).toBe(
      '/projects/a%20b/settings/mcp',
    )
  })
})

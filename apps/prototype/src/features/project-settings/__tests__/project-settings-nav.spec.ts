import { describe, expect, test } from 'bun:test'

import { PROTO_SAMPLES } from '../../../proto/samples'
import { PROJECTS_BY_ID, projectById } from '../fixtures/project-settings'
import {
  EProjectSettingsSection,
  PROJECT_NAV,
  hrefOfProjectSection,
  projectSectionOfPath,
} from '../project-settings-nav'

describe('project settings routes', () => {
  test('builds hrefs and resolves sections back from the path', () => {
    for (const item of PROJECT_NAV) {
      const href = hrefOfProjectSection({ projectId: 'rs-crm', section: item.section })
      expect(href).toBe(`/projects/rs-crm/settings/${item.section}`)
      expect(projectSectionOfPath(href)).toBe(item.section)
    }
  })

  test('encodes the project id', () => {
    expect(
      hrefOfProjectSection({ projectId: 'a/b', section: EProjectSettingsSection.Overview }),
    ).toBe('/projects/a%2Fb/settings/overview')
  })

  test('returns null for unknown or foreign paths', () => {
    expect(projectSectionOfPath('/projects/rs-crm/settings/billing')).toBeNull()
    expect(projectSectionOfPath('/projects/rs-crm/settings')).toBeNull()
    expect(projectSectionOfPath('/settings/mcp')).toBeNull()
    expect(projectSectionOfPath('/')).toBeNull()
  })

  test('resolves fixture project ids only', () => {
    expect(projectById('rs-crm')?.name).toBe('rs-crm')
    expect(projectById('missing')).toBeNull()
    expect(projectById('toString')).toBeNull()
    expect(Object.keys(PROJECTS_BY_ID)).toContain('rs-crm')
  })

  test('every section has a sample key whose projects resolve', () => {
    for (const item of PROJECT_NAV) {
      const samples = PROTO_SAMPLES[`/projects/[projectId]/settings/${item.section}`] ?? []
      expect(samples.length).toBeGreaterThan(0)
      for (const sample of samples) {
        const [, , projectId] = sample.path.split('/')
        expect(projectById(projectId ?? '')).not.toBeNull()
        expect(projectSectionOfPath(sample.path)).toBe(item.section)
      }
    }
  })
})

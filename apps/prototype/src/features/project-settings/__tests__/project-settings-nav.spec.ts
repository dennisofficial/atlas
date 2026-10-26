import { describe, expect, test } from 'bun:test'

import { PROTO_SAMPLES } from '../../../proto/samples'
import { PROJECTS_BY_ID, projectById } from '../fixtures/project-settings'
import {
  EProjectSettingsSection,
  PROJECT_NAV,
  hrefOfProjectSection,
  parseProjectSection,
} from '../project-settings-nav'

describe('project settings routes', () => {
  test('builds hrefs and parses sections back', () => {
    for (const item of PROJECT_NAV) {
      const href = hrefOfProjectSection({ projectId: 'rs-crm', section: item.section })
      expect(href).toBe(`/projects/rs-crm/settings/${item.section}`)
      expect(parseProjectSection(href.split('/').at(-1) ?? '')).toBe(item.section)
    }
  })

  test('encodes the project id', () => {
    expect(
      hrefOfProjectSection({ projectId: 'a/b', section: EProjectSettingsSection.Overview }),
    ).toBe('/projects/a%2Fb/settings/overview')
  })

  test('rejects unknown sections', () => {
    expect(parseProjectSection('billing')).toBeNull()
  })

  test('resolves fixture project ids only', () => {
    expect(projectById('rs-crm')?.name).toBe('rs-crm')
    expect(projectById('missing')).toBeNull()
    expect(projectById('toString')).toBeNull()
    expect(Object.keys(PROJECTS_BY_ID)).toContain('rs-crm')
  })

  test('the project sample resolves', () => {
    const samples = PROTO_SAMPLES['/projects/[projectId]/settings/[section]'] ?? []
    for (const sample of samples) {
      const [, , projectId, , section] = sample.path.split('/')
      expect(projectById(projectId ?? '')).not.toBeNull()
      expect(parseProjectSection(section ?? '')).not.toBeNull()
    }
  })
})

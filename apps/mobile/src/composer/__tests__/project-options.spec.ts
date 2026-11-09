import { describe, expect, it } from 'bun:test'

import { NO_PROJECT_LABEL, projectLabelOf } from '../project-options'

const projects = [
  { id: 'p1', name: 'atlas' },
  { id: 'p2', name: 'website' },
]

describe('projectLabelOf', () => {
  it('names the selected project', () => {
    expect(projectLabelOf({ projects, projectId: 'p2' })).toBe('website')
  })

  it('falls back to the no-project label when nothing is selected', () => {
    expect(projectLabelOf({ projects, projectId: null })).toBe(NO_PROJECT_LABEL)
  })

  it('falls back when the selected project is gone from the list', () => {
    expect(projectLabelOf({ projects, projectId: 'p9' })).toBe(NO_PROJECT_LABEL)
  })
})

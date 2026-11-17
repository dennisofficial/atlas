import { describe, expect, it } from 'bun:test'

import {
  NO_PROJECT_CHOICE,
  NO_PROJECT_LABEL,
  projectChoiceOf,
  projectChoicesOf,
  projectIdOfChoice,
  projectLabelOf,
} from '../project-options'

const projects = [
  { id: 'p1', name: 'atlas' },
  { id: 'p2', name: 'website' },
]

describe('project choices', () => {
  it('offers No project first, then every project', () => {
    expect(projectChoicesOf(projects)).toEqual([
      { value: NO_PROJECT_CHOICE, label: NO_PROJECT_LABEL },
      { value: 'p1', label: 'atlas' },
      { value: 'p2', label: 'website' },
    ])
  })

  it('still offers No project when there are no projects', () => {
    expect(projectChoicesOf([])).toEqual([{ value: NO_PROJECT_CHOICE, label: NO_PROJECT_LABEL }])
  })

  it('maps the No project choice to a null project id and back', () => {
    expect(projectIdOfChoice(NO_PROJECT_CHOICE)).toBeNull()
    expect(projectIdOfChoice('p1')).toBe('p1')
    expect(projectChoiceOf(null)).toBe(NO_PROJECT_CHOICE)
    expect(projectChoiceOf('p1')).toBe('p1')
  })
})

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

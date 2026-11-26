import { describe, expect, it } from 'bun:test'

import {
  EProjectHeaderAction,
  projectChevronLabelOf,
  projectHeaderActionsOf,
} from '../project-header-actions'

describe('projectHeaderActionsOf', () => {
  it('offers no project actions for the group that has no project', () => {
    expect(projectHeaderActionsOf({ projectId: null, title: 'No project' })).toEqual([])
  })

  it('offers project settings first and a new session in the project', () => {
    expect(projectHeaderActionsOf({ projectId: 'project-1', title: 'Atlas' })).toEqual([
      { action: EProjectHeaderAction.Settings, label: 'Project settings' },
      { action: EProjectHeaderAction.NewSession, label: 'New session in Atlas' },
    ])
  })
})

describe('projectChevronLabelOf', () => {
  it('names the toggle by what it will do next', () => {
    expect(projectChevronLabelOf({ expanded: true })).toBe('Collapse project')
    expect(projectChevronLabelOf({ expanded: false })).toBe('Expand project')
  })
})

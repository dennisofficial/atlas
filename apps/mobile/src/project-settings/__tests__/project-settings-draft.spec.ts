import { describe, expect, it } from 'bun:test'

import { EShipBehavior } from '@dltech/atlas-wire/web'

import type { Project } from '@dltech/atlas-wire/web'

import { draftIsDirty, draftIsValid, draftOf, updatePayloadOf } from '../project-settings-draft'

const project: Project = {
  id: 'project-1',
  name: 'Atlas',
  repo: 'dltech/atlas',
  baseBranch: 'main',
  additionalRepos: [{ repo: 'dltech/atlas-ui', branch: 'next' }, { repo: 'dltech/atlas-wire' }],
  groupId: null,
  description: 'The agent harness',
  shipBehavior: EShipBehavior.OpenPullRequest,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-02T00:00:00.000Z',
}

describe('draftOf', () => {
  it('starts from the editable fields of the fetched project', () => {
    expect(draftOf(project)).toEqual({ name: 'Atlas', description: 'The agent harness' })
  })
})

describe('draftIsDirty', () => {
  it('is clean while the draft matches the project', () => {
    expect(draftIsDirty({ project, draft: draftOf(project) })).toBe(false)
  })

  it('is dirty when the name changes', () => {
    expect(draftIsDirty({ project, draft: { ...draftOf(project), name: 'Atlas two' } })).toBe(true)
  })

  it('is dirty when the description changes', () => {
    expect(
      draftIsDirty({ project, draft: { ...draftOf(project), description: 'Something else' } }),
    ).toBe(true)
  })
})

describe('draftIsValid', () => {
  it('needs a name that is not only whitespace', () => {
    expect(draftIsValid({ draft: { name: 'Atlas', description: '' } })).toBe(true)
    expect(draftIsValid({ draft: { name: '   ', description: '' } })).toBe(false)
  })
})

describe('updatePayloadOf', () => {
  it('sends the whole project with only the edits applied', () => {
    expect(
      updatePayloadOf({
        project,
        draft: { name: '  Atlas two  ', description: 'A new description' },
      }),
    ).toEqual({
      projectId: 'project-1',
      name: 'Atlas two',
      repo: 'dltech/atlas',
      baseBranch: 'main',
      additionalRepos: [{ repo: 'dltech/atlas-ui', branch: 'next' }, { repo: 'dltech/atlas-wire' }],
      description: 'A new description',
      shipBehavior: EShipBehavior.OpenPullRequest,
    })
  })

  it('keeps a project with no repository', () => {
    const bare: Project = { ...project, repo: null, baseBranch: null, additionalRepos: [] }
    expect(updatePayloadOf({ project: bare, draft: draftOf(bare) })).toMatchObject({
      repo: null,
      baseBranch: null,
      additionalRepos: [],
    })
  })
})

import { describe, expect, it } from 'vitest'
import { EShipBehavior, type Project } from '@dltech/atlas-wire/web'

import { githubRepoOfOrigin, matchProject } from '../project-match'

const projectOf = (overrides: Partial<Project>): Project => ({
  id: 'proj_1',
  name: 'atlas',
  repo: 'comp-ai/atlas',
  baseBranch: null,
  additionalRepos: [],
  description: '',
  shipBehavior: EShipBehavior.OpenPullRequest,
  organizationId: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...overrides,
})

describe('githubRepoOfOrigin', () => {
  it.each([
    ['git@github.com:comp-ai/atlas.git', 'comp-ai/atlas'],
    ['https://github.com/comp-ai/atlas.git', 'comp-ai/atlas'],
    ['https://github.com/comp-ai/atlas/', 'comp-ai/atlas'],
    ['https://x-access-token:tok@github.com/comp-ai/atlas.git', 'comp-ai/atlas'],
    ['ssh://git@github.com/comp-ai/atlas.git', 'comp-ai/atlas'],
  ])('reads %s as %s', (origin, repo) => {
    expect(githubRepoOfOrigin(origin)).toBe(repo)
  })

  it.each([
    'git@gitlab.com:comp-ai/atlas.git',
    'https://github.example.com/comp-ai/atlas.git',
    'https://github.com/comp-ai',
    'https://github.com/comp-ai/atlas/tree/main',
    '/Users/me/repos/atlas',
    '',
  ])('answers null for %p', (origin) => {
    expect(githubRepoOfOrigin(origin)).toBeNull()
  })
})

describe('matchProject', () => {
  it('compares the repo case-insensitively', () => {
    const project = projectOf({ repo: 'Comp-AI/Atlas' })

    expect(matchProject({ projects: [project], repo: 'comp-ai/atlas' })).toBe(project)
  })

  it('answers undefined when no project names the repo', () => {
    const projects = [projectOf({ repo: 'comp-ai/other' }), projectOf({ id: 'proj_2', repo: null })]

    expect(matchProject({ projects, repo: 'comp-ai/atlas' })).toBeUndefined()
  })

  it('prefers the most recently updated project on a tie', () => {
    const older = projectOf({ id: 'older', updatedAt: '2026-10-01T00:00:00.000Z' })
    const newer = projectOf({ id: 'newer', updatedAt: '2026-10-05T00:00:00.000Z' })
    const middle = projectOf({ id: 'middle', updatedAt: '2026-10-03T00:00:00.000Z' })

    expect(matchProject({ projects: [older, newer, middle], repo: 'comp-ai/atlas' })?.id).toBe(
      'newer',
    )
  })
})

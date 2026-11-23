import { describe, expect, test } from 'bun:test'

import type { ProjectChoice } from '../../ui/project-prompt-model'
import { githubRepoOfOrigin, matchProject, projectRowsOf } from '../project-match'

const projectOf = (args: {
  id: string
  repo: string | null
  updatedAt: string
}): ProjectChoice => ({
  id: args.id,
  name: args.id,
  repo: args.repo,
  updatedAt: args.updatedAt,
})

describe('githubRepoOfOrigin', () => {
  test('reads owner and repo from every spelling of a github remote', () => {
    expect(githubRepoOfOrigin({ originUrl: 'git@github.com:a/b.git' })).toBe('a/b')
    expect(githubRepoOfOrigin({ originUrl: 'https://github.com/a/b/' })).toBe('a/b')
    expect(
      githubRepoOfOrigin({ originUrl: 'https://x-access-token:secret@github.com/a/b.git' }),
    ).toBe('a/b')
  })

  test('a remote that names no github repository is null', () => {
    expect(githubRepoOfOrigin({ originUrl: '/tmp/somewhere' })).toBeNull()
    expect(githubRepoOfOrigin({ originUrl: 'https://gitlab.com/a/b' })).toBeNull()
    expect(githubRepoOfOrigin({ originUrl: '' })).toBeNull()
  })
})

describe('matchProject', () => {
  test('the newest project on the same repo wins, case-insensitively', () => {
    const older = projectOf({ id: 'old', repo: 'a/b', updatedAt: '2026-11-01T00:00:00.000Z' })
    const newer = projectOf({ id: 'new', repo: 'A/B', updatedAt: '2026-11-20T00:00:00.000Z' })
    expect(matchProject({ projects: [older, newer], repo: 'a/B' })).toEqual(newer)
  })

  test('no match is undefined', () => {
    const project = projectOf({ id: 'p', repo: 'a/b', updatedAt: '2026-11-01T00:00:00.000Z' })
    const projectless = projectOf({ id: 'q', repo: null, updatedAt: '2026-11-02T00:00:00.000Z' })
    expect(matchProject({ projects: [project, projectless], repo: 'c/d' })).toBeUndefined()
  })
})

describe('projectRowsOf', () => {
  test('newest first, with the no-workspace row last', () => {
    const rows = projectRowsOf({
      projects: [
        projectOf({ id: 'old', repo: 'a/b', updatedAt: '2026-11-01T00:00:00.000Z' }),
        projectOf({ id: 'new', repo: 'a/c', updatedAt: '2026-11-20T00:00:00.000Z' }),
      ],
    })
    expect(rows.map((row) => row.projectId)).toEqual(['new', 'old', null])
  })
})

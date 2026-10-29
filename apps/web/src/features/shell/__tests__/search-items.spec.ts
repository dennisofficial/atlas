import { describe, expect, it } from 'bun:test'

import {
  ESearchKind,
  searchHrefOf,
  searchItemsOf,
  searchScoreOf,
  type SearchItem,
} from '../search-items'
import { EThreadStatus } from '../thread-status'
import { projectOf, sessionOf, threadOf } from './fixtures'

describe('searchItemsOf', () => {
  const { threads, projects } = searchItemsOf([
    {
      project: projectOf('p1'),
      sessions: [
        sessionOf(threadOf({ id: 't1', title: 'Fix login' })),
        sessionOf(threadOf({ id: 't2' })),
      ],
    },
  ])

  it('lists projects and threads with project names and fallback titles', () => {
    expect(projects).toEqual([{ kind: ESearchKind.Project, id: 'p1', label: 'project-p1' }])
    expect(threads).toEqual([
      {
        kind: ESearchKind.Thread,
        id: 't1',
        label: 'Fix login',
        projectName: 'project-p1',
        status: EThreadStatus.Idle,
      },
      {
        kind: ESearchKind.Thread,
        id: 't2',
        label: 'Untitled thread',
        projectName: 'project-p1',
        status: EThreadStatus.Idle,
      },
    ])
  })
})

describe('searchHrefOf', () => {
  it('routes threads to their page and projects to a new thread', () => {
    const thread = { kind: ESearchKind.Thread, id: 'a b' } as SearchItem
    const project = { kind: ESearchKind.Project, id: 'p/1' } as SearchItem
    expect(searchHrefOf(thread)).toBe('/threads/a%20b')
    expect(searchHrefOf(project)).toBe('/threads/new?project=p%2F1')
  })
})

describe('searchScoreOf', () => {
  it('matches everything on an empty query', () => {
    expect(searchScoreOf({ search: '  ', keywords: ['x'] })).toBe(1)
  })

  it('matches case-insensitive substrings of the title or name', () => {
    expect(searchScoreOf({ search: 'LOG', keywords: ['Fix login'] })).toBe(1)
    expect(searchScoreOf({ search: 'nope', keywords: ['Fix login'] })).toBe(0)
    expect(searchScoreOf({ search: 'a', keywords: [] })).toBe(0)
  })
})

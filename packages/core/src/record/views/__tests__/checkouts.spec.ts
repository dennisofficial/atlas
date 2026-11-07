import { describe, expect, it } from 'bun:test'

import type { V2Event } from '../../event'
import { checkoutsOf, initialCheckoutsState, stepCheckouts } from '../checkouts'
import { chainEvents } from '../../chain-events'
import { toRunId, toThreadId } from '../../../events/ids'
import type { V2Body } from '../../event'

type Observation = {
  repo?: string
  head?: string | null
  base?: string | null
  branches: { name: string; sha: string }[]
  worktrees?: { path: string; branch: string | null; sha: string; detached: boolean }[]
}

const observed = (observations: readonly Observation[]): V2Event[] => {
  const bodies: V2Body[] = observations.map((observation) => ({
    type: 'branches-observed',
    repo: observation.repo ?? '/work',
    head: observation.head ?? null,
    ...(observation.base === undefined ? {} : { base: observation.base }),
    branches: observation.branches,
    worktrees: observation.worktrees ?? [],
  }))
  return chainEvents({
    threadId: toThreadId('t'),
    runId: toRunId('r'),
    epoch: 1,
    at: '2026-11-03T12:00:00.000Z',
    bodies,
  })
}

const viewOf = (observations: readonly Observation[]) =>
  checkoutsOf(
    observed(observations).reduce((state, event) => {
      return event.type === 'branches-observed' ? stepCheckouts(state, event) : state
    }, initialCheckoutsState),
  )

describe('checkoutsOf', () => {
  it('excludes the base from the branches', () => {
    const view = viewOf([
      {
        head: 'main',
        base: 'main',
        branches: [
          { name: 'main', sha: 'a' },
          { name: 'feat', sha: 'b' },
        ],
      },
    ])
    expect(view.repos[0]?.branches.map((branch) => branch.name)).toEqual(['feat'])
  })

  it('lists no branches and names no primary when the base is unknown', () => {
    for (const base of [undefined, null]) {
      const view = viewOf([
        {
          head: 'feat',
          ...(base === undefined ? {} : { base }),
          branches: [{ name: 'feat', sha: 'a' }],
        },
      ])
      expect(view.repos[0]?.base).toBeNull()
      expect(view.repos[0]?.branches).toEqual([])
      expect(view.primary).toBeNull()
    }
  })

  it('picks the head as primary when it is not the base', () => {
    const view = viewOf([
      {
        head: 'feat',
        base: 'main',
        branches: [
          { name: 'main', sha: 'a' },
          { name: 'feat', sha: 'b' },
          { name: 'other', sha: 'c' },
        ],
      },
    ])
    expect(view.primary).toEqual({ repo: '/work', branch: 'feat' })
  })

  it('picks the most recently changed non-base branch when the head is the base', () => {
    const view = viewOf([
      {
        head: 'main',
        base: 'main',
        branches: [
          { name: 'main', sha: 'a' },
          { name: 'old', sha: 'b' },
          { name: 'new', sha: 'c' },
        ],
      },
      {
        head: 'main',
        base: 'main',
        branches: [
          { name: 'main', sha: 'a' },
          { name: 'old', sha: 'b' },
          { name: 'new', sha: 'd' },
        ],
      },
      {
        head: 'main',
        base: 'main',
        branches: [
          { name: 'main', sha: 'z' },
          { name: 'old', sha: 'b' },
          { name: 'new', sha: 'd' },
        ],
      },
    ])
    expect(view.primary).toEqual({ repo: '/work', branch: 'new' })
  })

  it('has no primary when only the base exists', () => {
    const view = viewOf([{ head: 'main', base: 'main', branches: [{ name: 'main', sha: 'a' }] }])
    expect(view.primary).toBeNull()
  })

  it('takes repos in first-observed order and links worktrees', () => {
    const view = viewOf([
      { repo: '/b', head: 'main', base: 'main', branches: [{ name: 'main', sha: 'a' }] },
      {
        repo: '/a',
        head: 'main',
        base: 'main',
        branches: [
          { name: 'main', sha: 'a' },
          { name: 'feat', sha: 'b' },
        ],
        worktrees: [{ path: '/wt/feat', branch: 'feat', sha: 'b', detached: false }],
      },
    ])
    expect(view.repos.map((repo) => repo.repo)).toEqual(['/b', '/a'])
    expect(view.repos[1]?.branches).toEqual([{ name: 'feat', sha: 'b', worktreePath: '/wt/feat' }])
    expect(view.primary).toEqual({ repo: '/a', branch: 'feat' })
  })
})

import { describe, expect, it } from 'bun:test'

import type { Routine } from '@dltech/atlas-protocol'
import { EShipBehavior, type Project } from '@dltech/atlas-wire/web'

import { routineGroupsOf } from '../routine-groups'

const project = (id: string, name: string): Project => ({
  id,
  name,
  repo: null,
  baseBranch: null,
  additionalRepos: [],
  description: '',
  shipBehavior: EShipBehavior.OpenPullRequest,
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
})

const routine = (routineId: string, projectId: string): Routine => ({
  routineId,
  projectId,
  name: routineId,
  prompt: 'Run it.',
  cron: '0 7 * * *',
  timezone: 'Europe/London',
  enabled: true,
  model: null,
  effort: null,
  fast: null,
  nextRunAt: '2026-11-11T07:00:00Z',
  lastRunAt: null,
  lastSessionId: null,
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
})

describe('routineGroupsOf', () => {
  it('groups the routines of each project in project order', () => {
    const groups = routineGroupsOf({
      routines: [routine('b', 'p2'), routine('a', 'p1'), routine('c', 'p2')],
      projects: [project('p1', 'atlas'), project('p2', 'rs-crm')],
    })

    expect(groups.map((group) => group.name)).toEqual(['atlas', 'rs-crm'])
    expect(groups[0]?.routines.map((entry) => entry.routineId)).toEqual(['a'])
    expect(groups[1]?.routines.map((entry) => entry.routineId)).toEqual(['b', 'c'])
  })

  it('leaves out projects that hold no routine', () => {
    const groups = routineGroupsOf({
      routines: [routine('a', 'p1')],
      projects: [project('p1', 'atlas'), project('p2', 'rs-crm')],
    })

    expect(groups).toHaveLength(1)
    expect(groups[0]?.key).toBe('p1')
  })

  it('still shows a routine whose project is not in the list', () => {
    const groups = routineGroupsOf({ routines: [routine('a', 'gone')], projects: [] })

    expect(groups).toEqual([{ key: 'gone', name: 'gone', routines: [routine('a', 'gone')] }])
  })
})

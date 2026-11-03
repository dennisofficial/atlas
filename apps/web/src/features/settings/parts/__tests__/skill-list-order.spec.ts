import { describe, expect, it } from 'bun:test'
import type { SkillSummary } from '@dltech/atlas-wire/web'

import {
  ariaSortOf,
  cycleSkillSort,
  ESkillSortKey,
  ESortDirection,
  orderSkills,
} from '../skill-list-order'

function summary(name: string, usedCount30d: number): SkillSummary {
  return {
    name,
    description: '',
    fileCount: 1,
    sizeBytes: 10,
    updatedAt: '2026-11-01T00:00:00Z',
    usage: { usedCount30d, lastUsedAt: null },
  }
}

describe('cycleSkillSort', () => {
  it('cycles off to ascending to descending to off', () => {
    const ascending = cycleSkillSort({ current: null, key: ESkillSortKey.Usage })
    expect(ascending).toEqual({ key: ESkillSortKey.Usage, direction: ESortDirection.Ascending })

    const descending = cycleSkillSort({ current: ascending, key: ESkillSortKey.Usage })
    expect(descending).toEqual({ key: ESkillSortKey.Usage, direction: ESortDirection.Descending })

    const off = cycleSkillSort({ current: descending, key: ESkillSortKey.Usage })
    expect(off).toBeNull()
  })

  it('restarts at ascending when a different column is clicked', () => {
    const current = { key: ESkillSortKey.Name, direction: ESortDirection.Descending } as const
    expect(cycleSkillSort({ current, key: ESkillSortKey.Usage })).toEqual({
      key: ESkillSortKey.Usage,
      direction: ESortDirection.Ascending,
    })
  })
})

describe('ariaSortOf', () => {
  it('reports the direction of the active column and none otherwise', () => {
    const sort = { key: ESkillSortKey.Usage, direction: ESortDirection.Descending } as const
    expect(ariaSortOf({ sort, key: ESkillSortKey.Usage })).toBe('descending')
    expect(ariaSortOf({ sort, key: ESkillSortKey.Name })).toBe('none')
    expect(ariaSortOf({ sort: null, key: ESkillSortKey.Usage })).toBe('none')
  })
})

describe('orderSkills', () => {
  it('returns input order when sort is off', () => {
    const input = [summary('tdd', 0), summary('ads', 9), summary('memory', 2)]
    expect(orderSkills({ skills: input, sort: null }).map((skill) => skill.name)).toEqual([
      'tdd',
      'ads',
      'memory',
    ])
  })

  it('sorts by name ascending and descending', () => {
    const skills = [summary('tdd', 0), summary('ads', 9), summary('memory', 2)]
    expect(
      orderSkills({
        skills,
        sort: { key: ESkillSortKey.Name, direction: ESortDirection.Ascending },
      }).map((skill) => skill.name),
    ).toEqual(['ads', 'memory', 'tdd'])
    expect(
      orderSkills({
        skills,
        sort: { key: ESkillSortKey.Name, direction: ESortDirection.Descending },
      }).map((skill) => skill.name),
    ).toEqual(['tdd', 'memory', 'ads'])
  })

  it('sorts by usage ascending and descending', () => {
    const skills = [
      summary('tdd', 5),
      summary('stale', 0),
      summary('memory', 12),
      summary('cold', 0),
    ]
    expect(
      orderSkills({
        skills,
        sort: { key: ESkillSortKey.Usage, direction: ESortDirection.Ascending },
      }).map((skill) => skill.name),
    ).toEqual(['stale', 'cold', 'tdd', 'memory'])
    expect(
      orderSkills({
        skills,
        sort: { key: ESkillSortKey.Usage, direction: ESortDirection.Descending },
      }).map((skill) => skill.name),
    ).toEqual(['memory', 'tdd', 'stale', 'cold'])
  })

  it('does not mutate the input', () => {
    const input = [summary('b', 2), summary('a', 1)]
    orderSkills({
      skills: input,
      sort: { key: ESkillSortKey.Usage, direction: ESortDirection.Ascending },
    })
    expect(input.map((skill) => skill.name)).toEqual(['b', 'a'])
  })
})

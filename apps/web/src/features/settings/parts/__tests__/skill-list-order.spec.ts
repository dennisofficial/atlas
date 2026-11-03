import { describe, expect, it } from 'bun:test'
import type { SkillSummary } from '@dltech/atlas-wire/web'

import { ESkillSort, orderSkills } from '../skill-list-order'

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

describe('orderSkills', () => {
  it('sorts by name by default', () => {
    const ordered = orderSkills({
      skills: [summary('tdd', 0), summary('ads', 9), summary('memory', 2)],
      sort: ESkillSort.Name,
    })
    expect(ordered.map((skill) => skill.name)).toEqual(['ads', 'memory', 'tdd'])
  })

  it('sorts ascending by usage so never-used skills come first', () => {
    const ordered = orderSkills({
      skills: [summary('tdd', 5), summary('stale', 0), summary('memory', 12), summary('cold', 0)],
      sort: ESkillSort.Usage,
    })
    expect(ordered.map((skill) => skill.name)).toEqual(['stale', 'cold', 'tdd', 'memory'])
  })

  it('does not mutate the input', () => {
    const input = [summary('b', 2), summary('a', 1)]
    orderSkills({ skills: input, sort: ESkillSort.Usage })
    expect(input.map((skill) => skill.name)).toEqual(['b', 'a'])
  })
})

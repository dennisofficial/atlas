import { describe, expect, it } from 'bun:test'
import { ESkillOrigin, type SkillSummary } from '@dltech/atlas-wire/web'

import { ESkillSortKey, ESortDirection, type SkillSort } from '../skill-list-order'
import { liveSelectedOf, skillIsSelectable, visibleSkillsOf } from '../skill-selection'

function summary(
  name: string,
  usedCount30d: number,
  extra: Partial<SkillSummary> = {},
): SkillSummary {
  return {
    name,
    description: '',
    fileCount: 1,
    sizeBytes: 10,
    updatedAt: '2026-11-01T00:00:00Z',
    usage: { usedCount30d, lastUsedAt: null },
    origin: ESkillOrigin.Personal,
    overridesBuiltIn: false,
    ...extra,
  }
}

const NAME_DESCENDING: SkillSort = { key: ESkillSortKey.Name, direction: ESortDirection.Descending }
const USAGE_DESCENDING: SkillSort = {
  key: ESkillSortKey.Usage,
  direction: ESortDirection.Descending,
}

describe('visibleSkillsOf', () => {
  const skills = [summary('tdd', 5), summary('stale', 0, { description: 'Unused' })]

  it('keeps the loaded order with no sort and no query', () => {
    expect(visibleSkillsOf({ skills, query: '', sort: null }).map((skill) => skill.name)).toEqual([
      'tdd',
      'stale',
    ])
  })

  it('filters by the query and sorts what is left', () => {
    expect(
      visibleSkillsOf({ skills, query: 'unused', sort: NAME_DESCENDING }).map(
        (skill) => skill.name,
      ),
    ).toEqual(['stale'])
    expect(
      visibleSkillsOf({ skills, query: '', sort: USAGE_DESCENDING }).map((skill) => skill.name),
    ).toEqual(['tdd', 'stale'])
  })
})

describe('liveSelectedOf', () => {
  it('drops a selected name that the query hides', () => {
    expect(liveSelectedOf({ selected: ['tdd', 'stale'], visible: [summary('tdd', 1)] })).toEqual([
      'tdd',
    ])
  })

  it('keeps the selected order and every visible name', () => {
    const visible = [summary('stale', 0), summary('tdd', 1)]
    expect(liveSelectedOf({ selected: ['tdd', 'stale'], visible })).toEqual(['tdd', 'stale'])
  })
})

describe('skillIsSelectable', () => {
  it('keeps built-in skills out of the selection', () => {
    expect(skillIsSelectable(summary('commit', 1, { origin: ESkillOrigin.BuiltIn }))).toBe(false)
  })

  it('selects every skill a scope owns', () => {
    expect(skillIsSelectable(summary('tdd', 1))).toBe(true)
    expect(skillIsSelectable(summary('tdd', 1, { origin: ESkillOrigin.Project }))).toBe(true)
    expect(skillIsSelectable(summary('tdd', 1, { origin: ESkillOrigin.Group }))).toBe(true)
  })
})

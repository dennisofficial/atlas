import { describe, expect, it } from 'bun:test'
import { EConfigLayer } from '@dltech/atlas-core'
import { ESkillOrigin, ESkillScope, type SkillSummary } from '@dltech/atlas-wire/web'

import {
  deleteConfirmCopyOf,
  deleteConfirmTitleOf,
  ESkillSortChoice,
  liveSelectedOf,
  ownSkillLayerOf,
  skillDescriptionLabelOf,
  skillIsSelectable,
  skillMetaLineOf,
  sortOfChoice,
  toggleSelected,
  visibleSkillsOf,
} from '../skills-list-state'

function summary(
  name: string,
  usedCount30d: number,
  extra: Partial<SkillSummary> = {},
): SkillSummary {
  return {
    name,
    description: '',
    fileCount: 1,
    sizeBytes: 2048,
    updatedAt: '2026-11-01T00:00:00Z',
    usage: { usedCount30d, lastUsedAt: null },
    origin: ESkillOrigin.Personal,
    overridesBuiltIn: false,
    ...extra,
  }
}

describe('sortOfChoice', () => {
  it('maps every menu choice to the shared sort model', () => {
    expect(sortOfChoice(ESkillSortChoice.Default)).toBeNull()
    expect(sortOfChoice(ESkillSortChoice.NameAscending)).toEqual({
      key: 'name',
      direction: 'ascending',
    })
    expect(sortOfChoice(ESkillSortChoice.NameDescending)).toEqual({
      key: 'name',
      direction: 'descending',
    })
    expect(sortOfChoice(ESkillSortChoice.UsageDescending)).toEqual({
      key: 'usage',
      direction: 'descending',
    })
    expect(sortOfChoice(ESkillSortChoice.UsageAscending)).toEqual({
      key: 'usage',
      direction: 'ascending',
    })
  })
})

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
      visibleSkillsOf({
        skills,
        query: 'unused',
        sort: sortOfChoice(ESkillSortChoice.NameDescending),
      }).map((skill) => skill.name),
    ).toEqual(['stale'])
    expect(
      visibleSkillsOf({
        skills,
        query: '',
        sort: sortOfChoice(ESkillSortChoice.UsageDescending),
      }).map((skill) => skill.name),
    ).toEqual(['tdd', 'stale'])
  })
})

describe('selection', () => {
  it('drops a selected name that the query hides', () => {
    expect(liveSelectedOf({ selected: ['tdd', 'stale'], visible: [summary('tdd', 1)] })).toEqual([
      'tdd',
    ])
  })

  it('toggles a name on and off', () => {
    const added = toggleSelected({ selected: [], name: 'tdd' })
    expect(added).toEqual(['tdd'])
    expect(toggleSelected({ selected: added, name: 'tdd' })).toEqual([])
  })

  it('keeps built-in skills out of the selection', () => {
    expect(skillIsSelectable(summary('commit', 1, { origin: 'built-in' }))).toBe(false)
    expect(skillIsSelectable(summary('tdd', 1))).toBe(true)
  })
})

describe('skillMetaLineOf', () => {
  it('reads usage, files, size and updated date', () => {
    expect(skillMetaLineOf({ skill: summary('tdd', 5) })).toBe(
      'Used 5× · 30d · 1 file · 2.0 KB · Nov 1',
    )
    expect(skillMetaLineOf({ skill: summary('tdd', 0) })).toStartWith('Never used')
  })
})

describe('delete confirmation copy', () => {
  it('names the skills and speaks about one or many', () => {
    expect(deleteConfirmTitleOf({ count: 1 })).toBe('Delete 1 skill?')
    expect(deleteConfirmTitleOf({ count: 3 })).toBe('Delete 3 skills?')
    expect(deleteConfirmCopyOf({ names: ['tdd'] })).toContain('this skill')
    expect(deleteConfirmCopyOf({ names: ['tdd', 'stale'] })).toContain('tdd, stale')
    expect(deleteConfirmCopyOf({ names: ['tdd', 'stale'] })).toContain('these skills')
  })
})

describe('ownSkillLayerOf', () => {
  it('names the layer the screen writes to', () => {
    expect(ownSkillLayerOf({ scope: ESkillScope.Personal })).toBeNull()
    expect(ownSkillLayerOf({ scope: ESkillScope.Project, projectId: 'p1' })).toBe(
      EConfigLayer.Project,
    )
    expect(ownSkillLayerOf({ scope: ESkillScope.Group, groupId: 'g1' })).toBe(EConfigLayer.Group)
  })
})

describe('skillDescriptionLabelOf', () => {
  it('falls back when a skill has no description', () => {
    expect(skillDescriptionLabelOf(summary('tdd', 0))).toBe('No description yet.')
    expect(skillDescriptionLabelOf(summary('tdd', 0, { description: 'Test first' }))).toBe(
      'Test first',
    )
  })
})

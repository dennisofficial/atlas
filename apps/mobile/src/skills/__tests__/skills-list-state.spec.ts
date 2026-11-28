import { describe, expect, it } from 'bun:test'
import { ESkillSortKey, ESortDirection } from '@dltech/atlas-client/settings'
import { EConfigLayer } from '@dltech/atlas-core'
import { ESkillOrigin, ESkillScope, type SkillSummary } from '@dltech/atlas-wire/web'

import {
  deleteConfirmCopyOf,
  deleteConfirmTitleOf,
  ESkillSortChoice,
  ownSkillLayerOf,
  skillDescriptionLabelOf,
  skillMetaLineOf,
  sortOfChoice,
  toggleSelected,
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
      key: ESkillSortKey.Name,
      direction: ESortDirection.Ascending,
    })
    expect(sortOfChoice(ESkillSortChoice.NameDescending)).toEqual({
      key: ESkillSortKey.Name,
      direction: ESortDirection.Descending,
    })
    expect(sortOfChoice(ESkillSortChoice.UsageDescending)).toEqual({
      key: ESkillSortKey.Usage,
      direction: ESortDirection.Descending,
    })
    expect(sortOfChoice(ESkillSortChoice.UsageAscending)).toEqual({
      key: ESkillSortKey.Usage,
      direction: ESortDirection.Ascending,
    })
  })
})

describe('toggleSelected', () => {
  it('toggles a name on and off', () => {
    const added = toggleSelected({ selected: [], name: 'tdd' })
    expect(added).toEqual(['tdd'])
    expect(toggleSelected({ selected: added, name: 'tdd' })).toEqual([])
  })
})

describe('skillMetaLineOf', () => {
  const NOW = Date.parse('2026-11-27T12:00:00Z')

  it('reads usage, files, size and updated date', () => {
    expect(skillMetaLineOf({ skill: summary('tdd', 5), now: NOW })).toBe(
      'Used 5× · 30d · 1 file · 2.0 KB · Nov 1',
    )
    expect(skillMetaLineOf({ skill: summary('tdd', 0), now: NOW })).toStartWith('Never used')
  })

  it('keeps file metadata visible while usage is pending or failed', () => {
    expect(skillMetaLineOf({ skill: summary('tdd', 0, { usagePending: true }), now: NOW })).toBe(
      '— · 1 file · 2.0 KB · Nov 1',
    )
  })

  it('adds the last use when the API knows it', () => {
    expect(
      skillMetaLineOf({
        skill: summary('tdd', 5, {
          usage: { usedCount30d: 5, lastUsedAt: '2026-11-27T09:00:00Z' },
        }),
        now: NOW,
      }),
    ).toBe('Used 5× · 30d · last used 3h ago · 1 file · 2.0 KB · Nov 1')
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

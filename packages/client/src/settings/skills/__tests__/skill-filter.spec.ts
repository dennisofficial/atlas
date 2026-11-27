import { describe, expect, it } from 'bun:test'
import type { SkillSummary } from '@dltech/atlas-wire/web'

import { matchesSkill } from '../skill-filter'

const SKILL: SkillSummary = {
  name: 'release-notes',
  description: 'Writes the changelog from merged PRs.',
  fileCount: 2,
  sizeBytes: 120,
  updatedAt: '2026-11-01T00:00:00Z',
  usage: { usedCount30d: 0, lastUsedAt: null },
  origin: 'personal',
  overridesBuiltIn: false,
}

describe('matchesSkill', () => {
  it('matches everything on an empty or blank query', () => {
    expect(matchesSkill({ skill: SKILL, query: '' })).toBe(true)
    expect(matchesSkill({ skill: SKILL, query: '   ' })).toBe(true)
  })

  it('matches the name and the description without case', () => {
    expect(matchesSkill({ skill: SKILL, query: 'RELEASE' })).toBe(true)
    expect(matchesSkill({ skill: SKILL, query: 'changelog' })).toBe(true)
  })

  it('rejects a skill that holds neither', () => {
    expect(matchesSkill({ skill: SKILL, query: 'deploy' })).toBe(false)
  })
})

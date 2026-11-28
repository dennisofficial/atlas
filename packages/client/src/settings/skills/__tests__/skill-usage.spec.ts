import { describe, expect, it } from 'bun:test'
import { ESkillOrigin, type SkillSummary } from '@dltech/atlas-wire/web'

import { withSkillUsage } from '../../skills'
import { skillRelativeTimeOf, skillUsageViewOf } from '../skill-usage'

const NOW = Date.parse('2026-11-27T12:00:00Z')

function summary(usage: { usedCount30d: number; lastUsedAt: string | null }): SkillSummary {
  return {
    name: 'tdd',
    description: '',
    fileCount: 1,
    sizeBytes: 10,
    updatedAt: '2026-11-01T00:00:00Z',
    usage,
    origin: ESkillOrigin.Personal,
    overridesBuiltIn: false,
  }
}

describe('skillRelativeTimeOf', () => {
  it('scales from seconds to years', () => {
    const at = (seconds: number): string =>
      skillRelativeTimeOf({ iso: new Date(NOW - seconds * 1000).toISOString(), now: NOW })
    expect(at(12)).toBe('just now')
    expect(at(5 * 60)).toBe('5m ago')
    expect(at(3 * 60 * 60)).toBe('3h ago')
    expect(at(2 * 24 * 60 * 60)).toBe('2d ago')
    expect(at(10 * 24 * 60 * 60)).toBe('1w ago')
    expect(at(60 * 24 * 60 * 60)).toBe('2mo ago')
    expect(at(400 * 24 * 60 * 60)).toBe('1y ago')
  })

  it('never reports a time in the future and rejects an unparseable stamp', () => {
    expect(skillRelativeTimeOf({ iso: '2026-11-27T13:00:00Z', now: NOW })).toBe('just now')
    expect(skillRelativeTimeOf({ iso: 'not a date', now: NOW })).toBe('—')
  })
})

describe('skillUsageViewOf', () => {
  it('does not label pending usage as never used', () => {
    const skill = { ...summary({ usedCount30d: 0, lastUsedAt: null }), usagePending: true }
    expect(skillUsageViewOf({ skill, now: NOW })).toEqual({
      usageLabel: '—',
      lastUsedLabel: null,
    })
  })

  it('keeps the placeholder after usage fails and replaces it after success', () => {
    const skill = { ...summary({ usedCount30d: 0, lastUsedAt: null }), usagePending: true }
    const failed = withSkillUsage({ skills: [skill], usage: undefined })
    expect(failed.map((entry) => skillUsageViewOf({ skill: entry, now: NOW }))).toEqual([
      { usageLabel: '—', lastUsedLabel: null },
    ])
    const loaded = withSkillUsage({
      skills: [skill],
      usage: { tdd: { usedCount30d: 4, lastUsedAt: '2026-11-27T09:00:00Z' } },
    })
    expect(loaded.map((entry) => skillUsageViewOf({ skill: entry, now: NOW }))).toEqual([
      { usageLabel: 'Used 4× · 30d', lastUsedLabel: 'last used 3h ago' },
    ])
  })
  it('reads never used when nothing loaded the skill in 30 days', () => {
    expect(
      skillUsageViewOf({ skill: summary({ usedCount30d: 0, lastUsedAt: null }), now: NOW }),
    ).toEqual({ usageLabel: 'Never used', lastUsedLabel: null })
  })

  it('adds the last use when the API knows it', () => {
    expect(
      skillUsageViewOf({
        skill: summary({ usedCount30d: 4, lastUsedAt: '2026-11-27T09:00:00Z' }),
        now: NOW,
      }),
    ).toEqual({ usageLabel: 'Used 4× · 30d', lastUsedLabel: 'last used 3h ago' })
  })

  it('leaves the last use out when the count is known but the time is not', () => {
    expect(
      skillUsageViewOf({ skill: summary({ usedCount30d: 2, lastUsedAt: null }), now: NOW }),
    ).toEqual({ usageLabel: 'Used 2× · 30d', lastUsedLabel: null })
  })
})

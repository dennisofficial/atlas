import { describe, expect, it } from 'bun:test'
import { EConfigLayer } from '@dltech/atlas-core'
import {
  ESkillOrigin,
  ESkillScope,
  type SkillLayer,
  type SkillSummary,
} from '@dltech/atlas-wire/web'
import { skillUsageKeyOf, skillUsageTargetOf, withSkillUsage } from '../skills'

const skill: SkillSummary = {
  name: 'review',
  description: 'Review code',
  fileCount: 1,
  sizeBytes: 100,
  updatedAt: '2026-11-27T12:00:00Z',
  origin: ESkillOrigin.Personal,
  overridesBuiltIn: false,
  usagePending: true,
  usage: { usedCount30d: 0, lastUsedAt: null },
}

const layer = (kind: EConfigLayer): SkillLayer => ({
  layer: kind,
  owner: { id: 'owner', name: 'Owner' },
  items: [{ ...skill, overriddenBy: null }],
})

describe('separate skill usage', () => {
  it('leaves pending summaries and layer metadata intact until usage arrives', () => {
    const items = layer(EConfigLayer.Personal).items
    expect(withSkillUsage({ skills: items, usage: undefined })).toEqual(items)
    const enriched = withSkillUsage({
      skills: items,
      usage: { review: { usedCount30d: 4, lastUsedAt: null } },
    })
    expect(enriched[0]).toMatchObject({
      usagePending: false,
      usage: { usedCount30d: 4 },
      overriddenBy: null,
    })
    expect(items[0]?.usagePending).toBe(true)
  })

  it('does not label a newly added skill unused when a cached usage reply lacks it', () => {
    expect(withSkillUsage({ skills: [skill], usage: {} })[0]?.usagePending).toBe(true)
  })

  it('maps built-ins and inherited layers to their original usage scopes', () => {
    expect(skillUsageTargetOf(layer(EConfigLayer.BuiltIn))).toEqual({ scope: ESkillScope.Personal })
    expect(skillUsageTargetOf(layer(EConfigLayer.Personal))).toEqual({
      scope: ESkillScope.Personal,
    })
    expect(skillUsageTargetOf(layer(EConfigLayer.Group))).toEqual({
      scope: ESkillScope.Group,
      groupId: 'owner',
    })
    expect(skillUsageTargetOf(layer(EConfigLayer.Project))).toEqual({
      scope: ESkillScope.Project,
      projectId: 'owner',
    })
    expect(skillUsageTargetOf(layer(EConfigLayer.Repo))).toBeUndefined()
  })

  it('keys scopes independently and deduplicates personal and built-in usage', () => {
    expect(skillUsageKeyOf({ scope: ESkillScope.Personal })).toBe('skill-usage:personal:')
    expect(skillUsageKeyOf({ scope: ESkillScope.Group, groupId: 'same' })).not.toBe(
      skillUsageKeyOf({ scope: ESkillScope.Project, projectId: 'same' }),
    )
  })
})

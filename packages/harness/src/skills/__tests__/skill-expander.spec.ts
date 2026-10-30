import { describe, expect, it } from 'bun:test'
import { ECommandGroup, ECommandKind } from '@dltech/atlas-core'

import type { SkillRegistryPort } from '../port'
import type { DiscoveredSkill } from '../skill'
import { skillExpander } from '../skill-expander'

const review = {
  spec: {
    name: 'review',
    kind: ECommandKind.Skill,
    summary: 'review',
    group: ECommandGroup.Workspace,
  },
  body: 'review body',
  userInvocable: true,
} as unknown as DiscoveredSkill

const registryOf = (skills: readonly DiscoveredSkill[]): SkillRegistryPort =>
  ({ all: () => skills }) as unknown as SkillRegistryPort

describe('skillExpander', () => {
  it('expands a mentioned skill from the live registry', () => {
    const expand = skillExpander({ skillRegistry: registryOf([review]) })
    expect(expand({ text: '/review now', context: [] })).toMatchObject([
      { type: 'context-loaded', key: 'review' },
    ])
  })

  it('expands nothing when the registry holds no skills', () => {
    const expand = skillExpander({ skillRegistry: registryOf([]) })
    expect(expand({ text: '/review', context: [] })).toEqual([])
  })
})

import { describe, expect, it } from 'bun:test'

import { ECommandGroup, ECommandKind, EContextSlot, type EventDraft } from '@dltech/atlas-core'

import { skillContextOf } from '../expand-mentions'
import type { DiscoveredSkill } from '../skill'

const skill = (name: string, userInvocable = true): DiscoveredSkill =>
  ({
    spec: { name, kind: ECommandKind.Skill, summary: name, group: ECommandGroup.Workspace },
    body: `${name} body`,
    userInvocable,
  }) as unknown as DiscoveredSkill

const skills = [skill('review'), skill('hidden', false)]

describe('skillContextOf', () => {
  it('loads a mentioned user-invocable skill', () => {
    const drafts = skillContextOf({ text: '/review this', skills, already: [] })
    expect(drafts).toMatchObject([
      { type: 'context-loaded', slot: EContextSlot.Skill, key: 'review' },
    ])
  })

  it('ignores skills that are not user-invocable and plain text', () => {
    expect(skillContextOf({ text: '/hidden now', skills, already: [] })).toEqual([])
    expect(skillContextOf({ text: 'no mention', skills, already: [] })).toEqual([])
  })

  it('does not duplicate a skill the client already loaded', () => {
    const already: EventDraft[] = [
      { type: 'context-loaded', slot: EContextSlot.Skill, key: 'review', content: 'x' },
    ]
    expect(skillContextOf({ text: '/review', skills, already })).toEqual([])
  })
})

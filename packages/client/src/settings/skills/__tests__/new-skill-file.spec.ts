import { describe, expect, it } from 'bun:test'
import { ESkillScope } from '@dltech/atlas-wire/web'

import { toBase64Utf8 } from '../skill-content'
import { EMPTY_SKILL_MD } from '../skill-name'
import { newSkillFileOf } from '../new-skill-file'

const hashOf = async (text: string): Promise<string> => `hash:${text.length}`

describe('newSkillFileOf', () => {
  it('writes the bare SKILL.md at the skill root of a personal skill', async () => {
    const input = await newSkillFileOf({
      target: { scope: ESkillScope.Personal },
      name: 'ios-settings-check',
      hashOf,
    })
    expect(input).toEqual({
      scope: ESkillScope.Personal,
      skill: 'ios-settings-check',
      path: 'SKILL.md',
      content: toBase64Utf8(EMPTY_SKILL_MD),
      contentHash: `hash:${EMPTY_SKILL_MD.length}`,
    })
  })

  it('carries the project or group the skill belongs to', async () => {
    const input = await newSkillFileOf({
      target: { scope: ESkillScope.Project, projectId: 'p1' },
      name: 'tdd',
      hashOf,
    })
    expect(input.scope).toBe(ESkillScope.Project)
    expect(input.projectId).toBe('p1')
  })

  it('hashes the plain text that the content carries', async () => {
    const input = await newSkillFileOf({
      target: { scope: ESkillScope.Personal },
      name: 'tdd',
      hashOf,
    })
    expect(input.contentHash).toBe(`hash:${EMPTY_SKILL_MD.length}`)
  })
})

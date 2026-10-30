import { describe, expect, it } from 'bun:test'

import { BUILT_IN_SKILLS } from '../../skills/manifest.generated'
import { parseSkill, ESkillOrigin } from '../../skills/skill'
import { BUILT_IN_SKILL_SPECS } from '../builtin.generated'
import { parseSkillSpec, skillFallbackNameOf } from '../parse'

const fromRegistryParse = BUILT_IN_SKILLS.flatMap((entry) => {
  const skill = parseSkill({
    text: entry.text,
    fallbackName: skillFallbackNameOf(entry.path),
    origin: ESkillOrigin.BuiltIn,
  })
  if (skill === undefined || !skill.userInvocable) return []
  const { name, summary, argumentHint } = skill.spec
  return [argumentHint === undefined ? { name, summary } : { name, summary, argumentHint }]
})

describe('BUILT_IN_SKILL_SPECS', () => {
  it('matches the built-ins parsed through parseSkill', () => {
    expect([...BUILT_IN_SKILL_SPECS]).toEqual(fromRegistryParse)
  })

  it('skips non-invocable skills and lowercases names', () => {
    expect(
      parseSkillSpec({ text: '---\nname: Foo\nuser-invocable: false\n---\n', fallbackName: 'x' })
        ?.userInvocable,
    ).toBe(false)
    expect(parseSkillSpec({ text: '---\nname: Foo\n---\n', fallbackName: 'x' })?.spec.name).toBe(
      'foo',
    )
  })
})

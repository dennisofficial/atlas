import { describe, expect, it } from 'bun:test'

import { skillSpecOf } from '../../core'
import { BUILT_IN_SKILLS } from '../builtin.generated'
import { BUILT_IN_SKILL_SPECS } from '../builtin-specs'

const expected = BUILT_IN_SKILLS.flatMap((builtIn) => {
  const parsed = skillSpecOf({ text: builtIn.text, fallbackName: builtIn.name })
  if (parsed === undefined || !parsed.userInvocable) return []
  const { name, summary, argumentHint } = parsed
  return [argumentHint === undefined ? { name, summary } : { name, summary, argumentHint }]
})

describe('BUILT_IN_SKILL_SPECS', () => {
  it('names every user-invocable built-in skill from its own SKILL.md', () => {
    expect([...BUILT_IN_SKILL_SPECS]).toEqual(expected)
    expect(BUILT_IN_SKILL_SPECS.map((spec) => spec.name)).toEqual(
      BUILT_IN_SKILLS.map((builtIn) => builtIn.name),
    )
  })

  it('carries the summary and the argument hint of the entry', () => {
    for (const spec of BUILT_IN_SKILL_SPECS) {
      const builtIn = BUILT_IN_SKILLS.find((candidate) => candidate.name === spec.name)
      const parsed = skillSpecOf({ text: builtIn?.text ?? '', fallbackName: spec.name })
      expect(spec.summary).toBe(parsed?.summary ?? '')
      if (parsed?.argumentHint !== undefined) expect(spec.argumentHint).toBe(parsed.argumentHint)
    }
  })
})

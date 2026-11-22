import { skillSpecOf, type ParsedSkillSpec } from '../core'
import { BUILT_IN_SKILLS } from './builtin.generated'

export type BuiltInSkillSpec = Omit<ParsedSkillSpec, 'userInvocable'> & {
  aliases?: readonly string[]
}

const specOf = (text: string, fallbackName: string): readonly BuiltInSkillSpec[] => {
  const parsed = skillSpecOf({ text, fallbackName })
  if (parsed === undefined || !parsed.userInvocable) return []
  const { name, summary, argumentHint } = parsed
  return [argumentHint === undefined ? { name, summary } : { name, summary, argumentHint }]
}

export const BUILT_IN_SKILL_SPECS: readonly BuiltInSkillSpec[] = BUILT_IN_SKILLS.flatMap(
  (builtIn) => specOf(builtIn.text, builtIn.name),
)

import type { ExpandContext } from '../pending'

import { skillContextOf } from './expand-mentions'
import type { SkillRegistryPort } from './port'

export function skillExpander(args: { skillRegistry: SkillRegistryPort }): ExpandContext {
  return ({ text, context }) =>
    skillContextOf({ text, skills: args.skillRegistry.all(), already: context })
}

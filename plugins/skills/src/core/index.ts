export {
  EMPTY_FRONTMATTER,
  frontmatterOf,
  skillBodyOf,
  type FrontmatterFields,
} from './frontmatter'
export {
  renderSkillListing,
  SKILL_LISTING_MAX_DESCRIPTION_CHARS,
  SKILL_LISTING_MIN_DESCRIPTION_CHARS,
  skillSummaryOf,
  type SkillListingEntry,
} from './listing'
export { expandSkillBody } from './expand'
export { skillFrontmatterOf, skillSpecOf, type ParsedSkillSpec } from './parse'
export {
  resolveSkillShadowing,
  type OriginatedSkill,
  type ResolvedSkills,
  type ShadowedSkill,
} from './precedence'
export {
  skillListRowSchema,
  skillsChangedSchema,
  type SkillListRow,
  type SkillsChanged,
} from './skill-events'
export {
  ESkillOrigin,
  ESkillWarning,
  KNOWN_FIELDS,
  SKILL_DESCRIPTION_MAX_LENGTH,
  SKILL_NAME_MAX_LENGTH,
  type SkillFrontmatter,
  type SkillWarning,
} from './spec'
export { validateSkill } from './validate'

import { skillsChangedSchema } from './skill-events'

export const skillsCoreSlots = {
  events: [skillsChangedSchema],
  views: [],
  commands: [],
} as const

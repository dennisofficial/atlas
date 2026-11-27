import type { SkillPutRequest } from '@dltech/atlas-wire/web'

import { SKILL_ENTRY_PATH, toBase64Utf8 } from './skill-content'
import { EMPTY_SKILL_MD } from './skill-name'
import type { SkillScopeTarget } from './skill-scope'

export const newSkillFileOf = async ({
  target,
  name,
  hashOf,
}: {
  target: SkillScopeTarget
  name: string
  hashOf: (text: string) => Promise<string>
}): Promise<SkillPutRequest> => ({
  ...target,
  skill: name,
  path: SKILL_ENTRY_PATH,
  content: toBase64Utf8(EMPTY_SKILL_MD),
  contentHash: await hashOf(EMPTY_SKILL_MD),
})

import type { RecordEvent } from '@dltech/atlas-core'
import type { ClientSlot } from '@dltech/atlas-plugin-sdk'

import { ESkillOrigin } from '../core'
import type { SkillListRow } from '../core/skill-events'

export { skillsCoreSlots } from '../core'
export type { SkillListRow } from '../core/skill-events'

export const skillsClient: ClientSlot = {
  hooks: [
    {
      name: 'skills-list',
      appliesTo: (event) => event.type === 'skills-changed',
    },
  ],
}

const NO_SKILLS: readonly SkillListRow[] = []

/** Each event carries the whole catalogue the pod last saw, so the last one is the list. */
export const latestSkillsOf = (events: readonly RecordEvent[]): readonly SkillListRow[] => {
  let latest = NO_SKILLS
  for (const event of events) {
    if (event.type === 'skills-changed') latest = event.skills
  }
  return latest
}

export const repoSkillsOf = (events: readonly RecordEvent[]): readonly SkillListRow[] =>
  latestSkillsOf(events).filter((skill) => skill.origin === ESkillOrigin.Repo)

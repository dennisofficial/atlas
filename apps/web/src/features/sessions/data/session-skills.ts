import type { CommandSpec, V2Event } from '@dltech/atlas-core'
import { repoSkillsOf } from '@dltech/atlas-plugin-skills/client'

import { mergeSkillSpecs, repoSkillSpecOf } from '@/features/threads/commands/skill-specs'

export const repoSkillSpecsOf = (events: readonly V2Event[]): readonly CommandSpec[] =>
  repoSkillsOf(events).map(repoSkillSpecOf)

export const skillMenuSpecs = (args: {
  catalogue: readonly CommandSpec[]
  events: readonly V2Event[]
}): readonly CommandSpec[] =>
  mergeSkillSpecs({ catalogue: args.catalogue, sandbox: repoSkillSpecsOf(args.events) })

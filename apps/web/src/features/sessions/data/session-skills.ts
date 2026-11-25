import { skillEntryOf, type CommandEntry } from '@dltech/atlas-commands'
import type { CommandSpec, RecordEvent } from '@dltech/atlas-core'
import { repoSkillsOf } from '@dltech/atlas-plugin-skills/client'
import type { CommandSkillWire } from '@dltech/atlas-wire/web'

export const skillEntryOfWire = (skill: CommandSkillWire): CommandEntry =>
  skillEntryOf({
    name: skill.name,
    description: skill.summary,
    argumentHint: skill.argumentHint ?? null,
  })

export const skillEntryOfSpec = (spec: CommandSpec): CommandEntry =>
  skillEntryOf({
    name: spec.name,
    description: spec.summary,
    argumentHint: spec.argumentHint ?? null,
  })

export const repoSkillEntriesOf = (events: readonly RecordEvent[]): readonly CommandEntry[] =>
  repoSkillsOf(events).map(skillEntryOf)

export const mergeSkillEntries = (args: {
  catalogue: readonly CommandEntry[]
  sandbox: readonly CommandEntry[]
}): readonly CommandEntry[] => {
  const sandboxNames = new Set(args.sandbox.map((entry) => entry.name))
  return [...args.catalogue.filter((entry) => !sandboxNames.has(entry.name)), ...args.sandbox]
}

export const skillMenuEntries = (args: {
  catalogue: readonly CommandEntry[]
  events: readonly RecordEvent[]
}): readonly CommandEntry[] =>
  mergeSkillEntries({ catalogue: args.catalogue, sandbox: repoSkillEntriesOf(args.events) })

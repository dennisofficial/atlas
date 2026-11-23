import {
  catalogueForSurface,
  catalogueOf,
  ESurface,
  type CommandEntry,
} from '@dltech/atlas-commands'

export const composerEntriesOf = (args: {
  commands: readonly CommandEntry[]
  skills: readonly CommandEntry[]
}): readonly CommandEntry[] =>
  catalogueForSurface({
    entries: catalogueOf({ commands: args.commands, skills: args.skills }),
    surface: ESurface.Web,
  })

export type CommandSection = { group: string; entries: readonly CommandEntry[] }

export const commandSectionsOf = (entries: readonly CommandEntry[]): readonly CommandSection[] => {
  const sections: { group: string; entries: CommandEntry[] }[] = []
  for (const entry of entries) {
    const last = sections.at(-1)
    if (last !== undefined && last.group === entry.group) last.entries.push(entry)
    else sections.push({ group: entry.group, entries: [entry] })
  }
  return sections
}

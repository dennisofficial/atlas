import { EClientAction, type CommandEntry } from '@dltech/atlas-commands'

const NAME_DRAFT = /^\/([a-z0-9-]*)$/i

const NO_CANDIDATES: readonly CommandEntry[] = []

export const menuQueryOf = (draft: string): string | null => {
  const match = NAME_DRAFT.exec(draft)
  return match === null ? null : (match[1] ?? '')
}

export const menuCandidatesOf = (args: {
  draft: string
  entries: readonly CommandEntry[]
}): readonly CommandEntry[] => {
  const query = menuQueryOf(args.draft)
  if (query === null) return NO_CANDIDATES
  const lowered = query.toLowerCase()
  return args.entries.filter((entry) => entry.name.toLowerCase().startsWith(lowered))
}

export const completedDraftOf = (name: string): string => `/${name} `

export const pickActionOf = (entry: CommandEntry): EClientAction | null =>
  entry.opens !== undefined && entry.argumentHint === undefined ? entry.opens : null

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

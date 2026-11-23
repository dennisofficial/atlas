import type { CommandEntry } from '@dltech/atlas-commands'
import {
  catalogueForSurface,
  catalogueOf,
  ECommandEntryKind,
  ECommandGroup,
  ECommandSource,
  ESurface,
  skillEntryOf,
} from '@dltech/atlas-commands'

export const TUI_LOCAL_NAMES: readonly string[] = ['new', 'sessions', 'exit', 'restart', 'wake']

export const TUI_OWNED_NAMES: readonly string[] = [...TUI_LOCAL_NAMES, 'rewind']

const local = (args: { name: string; summary: string }): CommandEntry => ({
  name: args.name,
  summary: args.summary,
  group: ECommandGroup.Session,
  kind: ECommandEntryKind.Command,
  source: ECommandSource.Builtin,
})

export const tuiLocalEntries = (): readonly CommandEntry[] => [
  local({ name: 'new', summary: 'start a session in this clone' }),
  local({ name: 'sessions', summary: 'go back to the session list' }),
  local({ name: 'exit', summary: 'quit — the session keeps running' }),
  local({ name: 'restart', summary: 'restart atlas on the latest build' }),
  local({ name: 'wake', summary: "wake this session's pod" }),
]

export const commandEntriesOf = (args: {
  commands: readonly CommandEntry[]
  skills: readonly { name: string; summary: string; argumentHint?: string | undefined }[]
}): readonly CommandEntry[] => [
  ...catalogueForSurface({
    entries: catalogueOf({
      commands: args.commands,
      skills: args.skills.map((skill) =>
        skillEntryOf({
          name: skill.name,
          description: skill.summary,
          argumentHint: skill.argumentHint ?? null,
        }),
      ),
    }),
    surface: ESurface.Tui,
  }),
  ...tuiLocalEntries(),
]

export const byName = (args: {
  entries: readonly CommandEntry[]
}): ReadonlyMap<string, CommandEntry> => {
  const map = new Map<string, CommandEntry>()
  for (const entry of args.entries) {
    if (map.has(entry.name)) continue
    map.set(entry.name, entry)
  }
  return map
}

import {
  catalogueForSurface,
  catalogueOf,
  ESurface,
  type CommandEntry,
} from '@dltech/atlas-commands'
import type {
  SessionCommandInput,
  SessionCommandOutput,
  SessionCommandRow,
} from '@dltech/atlas-protocol'

export const RESUME_COMMAND = 'resume'

export type ResumeApi = {
  command(input: SessionCommandInput): Promise<SessionCommandOutput>
}

export const requestResume = async (args: {
  api: ResumeApi
  sessionId: string
  agentId?: string | undefined
}): Promise<void> => {
  await args.api.command({
    sessionId: args.sessionId,
    name: RESUME_COMMAND,
    args: args.agentId === undefined ? {} : { agentId: args.agentId },
  })
}

export const resumePendingOf = (rows: readonly SessionCommandRow[] | undefined): boolean =>
  rows?.some((row) => row.name === RESUME_COMMAND) === true

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

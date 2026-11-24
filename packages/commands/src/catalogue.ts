import type { CommandEntry } from './entry'
import type { Command } from './registry'
import { ECommandGroup } from './spec'

const GROUP_ORDER: readonly ECommandGroup[] = [
  ECommandGroup.Context,
  ECommandGroup.Session,
  ECommandGroup.Workspace,
]

const groupRank = (group: ECommandGroup): number => GROUP_ORDER.indexOf(group)

const compareEntries = (left: CommandEntry, right: CommandEntry): number => {
  const byGroup = groupRank(left.group) - groupRank(right.group)
  if (byGroup !== 0) return byGroup
  return left.name.localeCompare(right.name)
}

export const listedCommands = (commands: readonly Command[]): readonly Command[] =>
  commands.filter((command) => command.spec.listed !== false)

export const catalogueOf = ({
  commands,
  skills,
}: {
  commands: readonly CommandEntry[]
  skills: readonly CommandEntry[]
}): readonly CommandEntry[] => {
  const commandNames = new Set(commands.map((entry) => entry.name))
  const kept = skills.filter((skill) => !commandNames.has(skill.name))
  return [...commands, ...kept].sort(compareEntries)
}

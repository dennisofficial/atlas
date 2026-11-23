import {
  ECommandEntryKind,
  ECommandGroup,
  ECommandSource,
  type CommandEntry,
} from '@dltech/atlas-commands'
import { describe, expect, it } from 'bun:test'

import { byName, commandEntriesOf, TUI_LOCAL_NAMES, tuiLocalEntries } from '../command-entries'

const command = (args: {
  name: string
  group: ECommandGroup
  argumentHint?: string
}): CommandEntry => ({
  name: args.name,
  summary: `${args.name} does something`,
  group: args.group,
  kind: ECommandEntryKind.Command,
  source: ECommandSource.Builtin,
  ...(args.argumentHint === undefined ? {} : { argumentHint: args.argumentHint }),
})

const CATALOGUE: readonly CommandEntry[] = [
  command({ name: 'rewind', group: ECommandGroup.Context, argumentHint: '<message>' }),
  command({ name: 'summarise', group: ECommandGroup.Context, argumentHint: '[message]' }),
  command({ name: 'rename', group: ECommandGroup.Session, argumentHint: '<name>' }),
  command({ name: 'resize', group: ECommandGroup.Workspace }),
]

const namesOf = (entries: readonly CommandEntry[]): readonly string[] =>
  entries.map((entry) => entry.name)

describe('the entries a tui session offers', () => {
  const built = commandEntriesOf({
    commands: CATALOGUE,
    skills: [
      { name: 'review', summary: 'review a branch' },
      { name: 'rename', summary: 'a skill that shadows a command' },
    ],
  })

  it('hides the message actions in the drawer and keeps rewind in the menu', () => {
    expect(namesOf(built)).not.toContain('summarise')
    expect(namesOf(built)).toContain('rewind')
  })

  it('lists a skill the catalogue also names exactly once, as the command', () => {
    expect(namesOf(built).filter((name) => name === 'rename')).toHaveLength(1)
    expect(built.find((entry) => entry.name === 'rename')?.kind).toBe(ECommandEntryKind.Command)
  })

  it('appends the rows the tui owns after the catalogue', () => {
    const tail = namesOf(built).slice(-TUI_LOCAL_NAMES.length)
    expect(tail).toEqual([...TUI_LOCAL_NAMES])
  })

  it('orders the groups Context, Session, Workspace', () => {
    const groups = built
      .filter((entry) => !TUI_LOCAL_NAMES.includes(entry.name))
      .map((entry) => entry.group)
    const rank = (group: ECommandGroup): number =>
      [ECommandGroup.Context, ECommandGroup.Session, ECommandGroup.Workspace].indexOf(group)
    expect(groups).toEqual([...groups].sort((left, right) => rank(left) - rank(right)))
  })

  it('keeps a skill in the workspace group', () => {
    expect(built.find((entry) => entry.name === 'review')?.group).toBe(ECommandGroup.Workspace)
  })
})

describe('the rows the tui adds itself', () => {
  const local = tuiLocalEntries()

  it('names the session picker sessions, because resume is the host command', () => {
    expect(namesOf(local)).toContain('sessions')
    expect(namesOf(local)).not.toContain('resume')
  })

  it('carries a summary and no argument hint on every row', () => {
    for (const entry of local) {
      expect(entry.summary.length).toBeGreaterThan(0)
      expect(entry.argumentHint).toBeUndefined()
    }
  })
})

describe('looking an entry up by name', () => {
  it('keeps the first entry when two share a name', () => {
    const first = command({ name: 'rewind', group: ECommandGroup.Context })
    const second = command({ name: 'rewind', group: ECommandGroup.Workspace })
    expect(byName({ entries: [first, second] }).get('rewind')).toBe(first)
  })
})

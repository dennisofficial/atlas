import { describe, expect, it } from 'bun:test'

import {
  EClientAction,
  ECommandEntryKind,
  ECommandGroup,
  ECommandSource,
} from '@dltech/atlas-commands'
import type { CommandEntry } from '@dltech/atlas-commands'

import {
  commandSectionsOf,
  completedDraftOf,
  menuCandidatesOf,
  menuQueryOf,
  pickActionOf,
} from '../slash-menu-model'

const entryOf = (args: Partial<CommandEntry> & { name: string }): CommandEntry => ({
  summary: `${args.name} summary`,
  group: ECommandGroup.Session,
  kind: ECommandEntryKind.Command,
  source: ECommandSource.Builtin,
  ...args,
})

const ENTRIES: readonly CommandEntry[] = [
  entryOf({ name: 'model', opens: EClientAction.ModelPicker }),
  entryOf({ name: 'rename', argumentHint: '<name>' }),
  entryOf({
    name: 'review',
    group: ECommandGroup.Workspace,
    kind: ECommandEntryKind.Skill,
    source: ECommandSource.Skill,
  }),
]

describe('menuQueryOf', () => {
  it('reads the name prefix of a draft that starts with a slash', () => {
    expect(menuQueryOf('/')).toBe('')
    expect(menuQueryOf('/mo')).toBe('mo')
  })

  it('closes once the draft holds a space or does not start with a slash', () => {
    expect(menuQueryOf('/rename bench')).toBeNull()
    expect(menuQueryOf('/rename ')).toBeNull()
    expect(menuQueryOf('hello /mo')).toBeNull()
    expect(menuQueryOf('')).toBeNull()
  })
})

describe('menuCandidatesOf', () => {
  it('keeps the catalogue order of the entries a prefix matches', () => {
    expect(menuCandidatesOf({ draft: '/re', entries: ENTRIES }).map((entry) => entry.name)).toEqual(
      ['rename', 'review'],
    )
  })

  it('lists every entry for a bare slash', () => {
    expect(menuCandidatesOf({ draft: '/', entries: ENTRIES })).toHaveLength(3)
  })

  it('lists nothing once the draft is a message', () => {
    expect(menuCandidatesOf({ draft: '/rename bench', entries: ENTRIES })).toEqual([])
  })
})

describe('completedDraftOf', () => {
  it('completes a name and leaves a space for the argument', () => {
    expect(completedDraftOf('rename')).toBe('/rename ')
  })
})

describe('pickActionOf', () => {
  it('runs the client action of a command that takes no arguments', () => {
    expect(pickActionOf(entryOf({ name: 'model', opens: EClientAction.ModelPicker }))).toBe(
      EClientAction.ModelPicker,
    )
  })

  it('completes a command that takes an argument and any skill', () => {
    expect(pickActionOf(entryOf({ name: 'rename', argumentHint: '<name>' }))).toBeNull()
    expect(pickActionOf(ENTRIES[2] as CommandEntry)).toBeNull()
  })
})

describe('commandSectionsOf', () => {
  it('groups consecutive entries by their group', () => {
    const sections = commandSectionsOf(ENTRIES)
    expect(sections.map((section) => section.group)).toEqual([
      ECommandGroup.Session,
      ECommandGroup.Workspace,
    ])
    expect(sections.map((section) => section.entries.length)).toEqual([2, 1])
  })
})

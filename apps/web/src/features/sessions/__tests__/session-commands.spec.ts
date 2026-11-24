import { describe, expect, it } from 'bun:test'

import {
  EClientAction,
  ECommandEntryKind,
  ECommandGroup,
  ECommandSource,
  type CommandEntry,
} from '@dltech/atlas-commands'

import { commandSectionsOf, composerEntriesOf } from '../data/session-commands'
import { composerActionsOf } from '../data/session-composer-actions'

const commandOf = (args: {
  name: string
  group?: ECommandGroup
  opens?: EClientAction
}): CommandEntry => ({
  name: args.name,
  summary: `${args.name} summary`,
  group: args.group ?? ECommandGroup.Session,
  kind: ECommandEntryKind.Command,
  source: ECommandSource.Builtin,
  ...(args.opens === undefined ? {} : { opens: args.opens }),
})

const skillOf = (name: string, group?: ECommandGroup): CommandEntry => ({
  name,
  summary: `${name} skill`,
  group: group ?? ECommandGroup.Workspace,
  kind: ECommandEntryKind.Skill,
  source: ECommandSource.Skill,
})

describe('composerEntriesOf', () => {
  const commands = [
    commandOf({ name: 'rename' }),
    commandOf({ name: 'help', opens: EClientAction.CommandList }),
    commandOf({ name: 'model', opens: EClientAction.ModelPicker }),
    commandOf({ name: 'rewind' }),
    commandOf({ name: 'summarise' }),
    commandOf({ name: 'compact' }),
  ]
  const skills = [skillOf('review'), skillOf('rename'), skillOf('tdd')]

  it('lists the commands and the skills of the web surface in one catalogue', () => {
    const names = composerEntriesOf({ commands, skills }).map((entry) => entry.name)

    expect(names).toEqual(['compact', 'help', 'model', 'rename', 'review', 'tdd'])
  })

  it('leaves out a skill whose name a command already has', () => {
    const kept = composerEntriesOf({ commands, skills }).filter((entry) => entry.name === 'rename')

    expect(kept).toHaveLength(1)
    expect(kept[0]?.kind).toBe(ECommandEntryKind.Command)
  })

  it('leaves out the names the web answers as message actions', () => {
    const names = composerEntriesOf({ commands, skills }).map((entry) => entry.name)

    expect(names).not.toContain('rewind')
    expect(names).not.toContain('summarise')
  })

  it('sorts by group and then by name', () => {
    const groups = composerEntriesOf({
      commands: [commandOf({ name: 'b', group: ECommandGroup.Workspace })],
      skills: [skillOf('a'), skillOf('c')],
    }).map((entry) => `${entry.group}:${entry.name}`)

    expect(groups).toEqual(['Workspace:a', 'Workspace:b', 'Workspace:c'])
  })
})

describe('commandSectionsOf', () => {
  it('keeps one section per run of a group in catalogue order', () => {
    const sections = commandSectionsOf([
      commandOf({ name: 'compact', group: ECommandGroup.Context }),
      commandOf({ name: 'help', group: ECommandGroup.Session }),
      commandOf({ name: 'model', group: ECommandGroup.Session }),
      skillOf('review'),
    ])

    expect(sections.map((section) => [section.group, section.entries.length])).toEqual([
      ['Context', 1],
      ['Session', 2],
      ['Workspace', 1],
    ])
  })
})

describe('composerActionsOf', () => {
  it('reports the panel commands, because only the app draws them', () => {
    const hidden: string[] = []
    const actions = composerActionsOf({
      openModelPicker: () => {},
      openCommandList: () => {},
      reportHidden: (name) => void hidden.push(name),
    })

    actions[EClientAction.Skills]()
    actions[EClientAction.Mcp]()
    actions[EClientAction.Shells]()

    expect(hidden).toEqual(['skills', 'mcp', 'shells'])
  })

  it('answers every client action', () => {
    const actions = composerActionsOf({
      openModelPicker: () => {},
      openCommandList: () => {},
      reportHidden: () => {},
    })

    expect(Object.keys(actions).sort()).toEqual(Object.values(EClientAction).sort())
    for (const action of Object.values(EClientAction))
      expect(typeof actions[action]).toBe('function')
  })

  it('opens the picker and the command list', () => {
    const opened: string[] = []
    const actions = composerActionsOf({
      openModelPicker: () => void opened.push('model'),
      openCommandList: () => void opened.push('list'),
      reportHidden: (name) => void opened.push(name),
    })

    actions[EClientAction.ModelPicker]()
    actions[EClientAction.CommandList]()

    expect(opened).toEqual(['model', 'list'])
  })
})

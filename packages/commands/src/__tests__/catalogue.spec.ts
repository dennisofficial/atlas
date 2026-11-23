import { describe, expect, it } from 'bun:test'
import { catalogueOf } from '../catalogue'
import { ECommandEntryKind, ECommandSource, type CommandEntry } from '../entry'
import { ECommandGroup } from '../spec'

const commandEntry = (name: string, group: ECommandGroup): CommandEntry => ({
  name,
  summary: `${name} summary`,
  group,
  kind: ECommandEntryKind.Command,
  source: ECommandSource.Builtin,
})

const skillEntry = (name: string): CommandEntry => ({
  name,
  summary: `${name} skill`,
  group: ECommandGroup.Workspace,
  kind: ECommandEntryKind.Skill,
  source: ECommandSource.Skill,
})

describe('catalogueOf', () => {
  it('sorts by group order and then by name', () => {
    const catalogue = catalogueOf({
      commands: [
        commandEntry('resize', ECommandGroup.Session),
        commandEntry('background', ECommandGroup.Workspace),
        commandEntry('rename', ECommandGroup.Session),
        commandEntry('rewind', ECommandGroup.Context),
      ],
      skills: [],
    })
    expect(catalogue.map((entry) => entry.name)).toEqual([
      'rewind',
      'rename',
      'resize',
      'background',
    ])
  })

  it('drops a skill whose name matches a command', () => {
    const catalogue = catalogueOf({
      commands: [commandEntry('model', ECommandGroup.Session)],
      skills: [skillEntry('model'), skillEntry('review')],
    })
    expect(catalogue.map((entry) => entry.name)).toEqual(['model', 'review'])
    expect(catalogue[0]?.kind).toBe(ECommandEntryKind.Command)
  })
})

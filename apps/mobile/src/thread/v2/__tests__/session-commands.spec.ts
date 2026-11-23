import { describe, expect, it } from 'bun:test'

import {
  EClientAction,
  ECommandEntryKind,
  ECommandGroup,
  ECommandSource,
  type CommandEntry,
} from '@dltech/atlas-commands'
import { type V2Event } from '@dltech/atlas-core'

import type { IModelOption } from '../../../composer/model-options'
import {
  choiceOfSessionRows,
  composerActionsOf,
  mobileEntriesOf,
  modelSetArgsOf,
  selectionOfChoice,
} from '../session-commands'

const entryOf = (args: Partial<CommandEntry> & { name: string }): CommandEntry => ({
  summary: `${args.name} summary`,
  group: ECommandGroup.Session,
  kind: ECommandEntryKind.Command,
  source: ECommandSource.Builtin,
  ...args,
})

const skillsChanged = (skills: readonly { name: string }[]): V2Event =>
  ({
    type: 'skills-changed',
    skills: skills.map((skill) => ({
      name: skill.name,
      description: `${skill.name} skill`,
      argumentHint: null,
      origin: 'repo',
    })),
  }) as unknown as V2Event

const COMMANDS: readonly CommandEntry[] = [
  entryOf({ name: 'help', opens: EClientAction.CommandList }),
  entryOf({ name: 'model', opens: EClientAction.ModelPicker }),
  entryOf({ name: 'rename', argumentHint: '<name>' }),
  entryOf({ name: 'rewind', group: ECommandGroup.Context }),
  entryOf({ name: 'summarise', group: ECommandGroup.Context }),
]

const MODEL: IModelOption = {
  id: 'anthropic/claude-sonnet-4-5',
  label: 'Sonnet 4.5',
  provider: 'Anthropic',
  providerId: 'anthropic',
  monogram: 'A',
  efforts: ['low', 'medium', 'high'],
  context: '200k',
  rate: null,
  fast: false,
}

describe('mobileEntriesOf', () => {
  it('hides the names a message action does and keeps the rest', () => {
    const names = mobileEntriesOf({ commands: COMMANDS, events: [] }).map((entry) => entry.name)
    expect(names).toEqual(['help', 'model', 'rename'])
  })

  it('lists the skills the last skills-changed event carried', () => {
    const entries = mobileEntriesOf({
      commands: COMMANDS,
      events: [skillsChanged([{ name: 'review' }]), skillsChanged([{ name: 'deploy' }])],
    })
    expect(
      entries.filter((entry) => entry.kind === ECommandEntryKind.Skill).map((e) => e.name),
    ).toEqual(['deploy'])
  })

  it('drops a skill whose name a command holds', () => {
    const entries = mobileEntriesOf({
      commands: COMMANDS,
      events: [skillsChanged([{ name: 'rename' }, { name: 'deploy' }])],
    })
    const renamed = entries.filter((entry) => entry.name === 'rename')
    expect(renamed).toHaveLength(1)
    expect(renamed[0]?.kind).toBe(ECommandEntryKind.Command)
  })
})

describe('composerActionsOf', () => {
  it('answers every client action', () => {
    const opened: string[] = []
    const actions = composerActionsOf({
      openModelPicker: () => opened.push('model'),
      openCommandList: () => opened.push('list'),
    })
    for (const action of Object.values(EClientAction)) actions[action]()
    expect(opened.sort()).toEqual(['list', 'model'])
  })
})

describe('modelSetArgsOf', () => {
  it('posts the chosen model with its effort and fast mode', () => {
    expect(
      modelSetArgsOf({
        selection: { model: MODEL, effort: 'high', fast: true },
        personalId: 'anthropic/claude-opus-5-5',
      }),
    ).toEqual({ model: MODEL.id, effort: 'high', fast: true })
  })

  it('leaves fast out unless it is on', () => {
    expect(
      modelSetArgsOf({ selection: { model: MODEL, effort: 'low', fast: false }, personalId: '' }),
    ).toEqual({ model: MODEL.id, effort: 'low' })
  })

  it('posts the personal model when the operator picks the default', () => {
    expect(modelSetArgsOf({ selection: null, personalId: 'openai/gpt-5' })).toEqual({
      model: 'openai/gpt-5',
    })
  })

  it('posts nothing when there is no personal model to fall back to', () => {
    expect(modelSetArgsOf({ selection: null, personalId: '' })).toBeNull()
  })
})

describe('selectionOfChoice', () => {
  it('resolves the session model against the offered models', () => {
    const selection = selectionOfChoice({
      models: [MODEL],
      choice: { ref: MODEL.id, effort: 'high', fast: false },
    })
    expect(selection?.model.id).toBe(MODEL.id)
    expect(selection?.effort).toBe('high')
  })

  it('has no selection when the session carries no model', () => {
    expect(selectionOfChoice({ models: [MODEL], choice: null })).toBeNull()
  })
})

describe('choiceOfSessionRows', () => {
  it('finds the row of this session', () => {
    const rows = [
      { sessionId: 'ses_other', model: { ref: 'a/b', effort: 'low', fast: false } },
      { sessionId: 'ses_1', model: { ref: MODEL.id, effort: 'medium', fast: false } },
    ]
    expect(choiceOfSessionRows(rows, 'ses_1')).toEqual({
      ref: MODEL.id,
      effort: 'medium',
      fast: false,
    })
  })

  it('has no choice when the session is not listed', () => {
    expect(choiceOfSessionRows([], 'ses_1')).toBeNull()
  })
})

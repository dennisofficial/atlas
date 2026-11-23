import { describe, expect, it } from 'bun:test'

import { clientActionOfEntries } from '../client'
import { ECommandEntryKind, ECommandSource, type CommandEntry } from '../entry'
import { EClientAction, ECommandGroup } from '../spec'

const entryOf = (args: {
  name: string
  opens?: EClientAction | undefined
  kind?: ECommandEntryKind | undefined
}): CommandEntry => ({
  name: args.name,
  summary: args.name,
  group: ECommandGroup.Session,
  kind: args.kind ?? ECommandEntryKind.Command,
  source: args.kind === ECommandEntryKind.Skill ? ECommandSource.Skill : ECommandSource.Builtin,
  ...(args.opens === undefined ? {} : { opens: args.opens }),
})

const entries: readonly CommandEntry[] = [
  entryOf({ name: 'help', opens: EClientAction.CommandList }),
  entryOf({ name: 'rename' }),
  entryOf({ name: 'review', kind: ECommandEntryKind.Skill }),
  entryOf({ name: 'model', opens: EClientAction.ModelPicker }),
]

describe('clientActionOfEntries', () => {
  it('returns the action of a client command in the catalogue', () => {
    expect(clientActionOfEntries({ text: '/model', entries })).toBe(EClientAction.ModelPicker)
    expect(clientActionOfEntries({ text: '/help', entries })).toBe(EClientAction.CommandList)
    expect(clientActionOfEntries({ text: '/help\nmore', entries })).toBe(EClientAction.CommandList)
  })

  it('returns null for a command that runs elsewhere, a skill and an unknown name', () => {
    expect(clientActionOfEntries({ text: '/rename bench', entries })).toBeNull()
    expect(clientActionOfEntries({ text: '/review', entries })).toBeNull()
    expect(clientActionOfEntries({ text: '/nope', entries })).toBeNull()
  })

  it('returns null for a message, a leading space, a code span and a name with arguments', () => {
    expect(clientActionOfEntries({ text: 'hello', entries })).toBeNull()
    expect(clientActionOfEntries({ text: ' /model', entries })).toBeNull()
    expect(clientActionOfEntries({ text: '`/model`', entries })).toBeNull()
    expect(clientActionOfEntries({ text: '/model now', entries })).toBeNull()
  })

  it('returns null against an empty catalogue', () => {
    expect(clientActionOfEntries({ text: '/model', entries: [] })).toBeNull()
  })
})

import { describe, expect, it } from 'bun:test'
import { ECommandGroup, ECommandTiming } from '@dltech/atlas-core'
import { z } from 'zod'
import { commandOf, composeCommands, defineCommand } from '../registry'

const specOf = (name: string) => ({
  name,
  summary: `${name} summary`,
  group: ECommandGroup.Session,
  args: z.strictObject({ title: z.string() }),
  timing: ECommandTiming.Settled,
})

describe('defineCommand', () => {
  it('derives the inbox kind from the name', () => {
    const command = defineCommand({ spec: specOf('rename') })
    expect(command.inboxKind).toBe('command:rename')
    expect(command.spec.name).toBe('rename')
  })

  it('freezes the command and its spec', () => {
    const command = defineCommand({ spec: specOf('rename') })
    expect(Object.isFrozen(command)).toBe(true)
    expect(Object.isFrozen(command.spec)).toBe(true)
  })

  it.each(['/rename', 'Rename', '', 'two words', '1st'])('refuses the name %p', (name) => {
    expect(() => defineCommand({ spec: specOf(name) })).toThrow('lowercase')
  })
})

describe('composeCommands', () => {
  it('indexes commands by name and by inbox kind', () => {
    const rename = defineCommand({ spec: specOf('rename') })
    const summarise = defineCommand({ spec: specOf('summarise') })
    const registry = composeCommands([rename, summarise])
    expect(registry.all).toEqual([rename, summarise])
    expect(registry.byName.get('summarise')).toBe(summarise)
    expect(registry.byInboxKind.get('command:rename')).toBe(rename)
  })

  it('throws on a duplicate name', () => {
    const first = defineCommand({ spec: specOf('rename') })
    const second = defineCommand({ spec: specOf('rename') })
    expect(() => composeCommands([first, second])).toThrow('duplicate command "rename"')
  })

  it('composes an empty registry', () => {
    const registry = composeCommands([])
    expect(registry.all).toEqual([])
    expect(registry.byName.size).toBe(0)
  })
})

describe('commandOf', () => {
  it('finds a registered command and not an unknown one', () => {
    const rename = defineCommand({ spec: specOf('rename') })
    const registry = composeCommands([rename])
    expect(commandOf({ registry, name: 'rename' })).toBe(rename)
    expect(commandOf({ registry, name: 'nope' })).toBeUndefined()
  })
})

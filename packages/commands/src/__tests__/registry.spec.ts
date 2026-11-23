import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { commandOf, composeCommands, defineCommand } from '../registry'
import { EClientAction, ECommandGroup, ECommandRunsIn } from '../spec'

const specOf = (name: string, runsIn: ECommandRunsIn = ECommandRunsIn.Host) => ({
  name,
  summary: `${name} summary`,
  group: ECommandGroup.Session,
  args: z.strictObject({ title: z.string() }),
  runsIn,
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

  it('refuses a client command that names no client action', () => {
    expect(() => defineCommand({ spec: specOf('model', ECommandRunsIn.Client) })).toThrow(
      'must name the client action it opens',
    )
  })

  it('refuses a host command that names a client action', () => {
    expect(() =>
      defineCommand({
        spec: { ...specOf('model'), opens: EClientAction.ModelPicker },
      }),
    ).toThrow('cannot open a client action')
  })

  it('accepts a client command with its client action', () => {
    const command = defineCommand({
      spec: { ...specOf('model', ECommandRunsIn.Client), opens: EClientAction.ModelPicker },
    })
    expect(command.spec.opens).toBe(EClientAction.ModelPicker)
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

  it('keeps control and client commands out of the inbox index', () => {
    const rename = defineCommand({ spec: specOf('rename', ECommandRunsIn.Control) })
    const model = defineCommand({
      spec: { ...specOf('model', ECommandRunsIn.Client), opens: EClientAction.CommandList },
    })
    const summarise = defineCommand({ spec: specOf('summarise') })
    const registry = composeCommands([rename, model, summarise])
    expect(registry.byName.get('rename')).toBe(rename)
    expect(registry.byName.get('model')).toBe(model)
    expect(registry.byInboxKind.has('command:rename')).toBe(false)
    expect(registry.byInboxKind.has('command:model')).toBe(false)
    expect(registry.byInboxKind.get('command:summarise')).toBe(summarise)
  })

  it('refuses the same name across handling kinds', () => {
    const host = defineCommand({ spec: specOf('rename') })
    const control = defineCommand({ spec: specOf('rename', ECommandRunsIn.Control) })
    expect(() => composeCommands([host, control])).toThrow('duplicate command "rename"')
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

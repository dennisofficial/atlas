import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { clientActionOf } from '../client'
import { composeCommands, defineCommand, type CommandRegistry } from '../registry'
import { EClientAction, ECommandGroup, ECommandRunsIn } from '../spec'

const model = defineCommand({
  spec: {
    name: 'model',
    summary: 'Pick the model for this session',
    group: ECommandGroup.Session,
    args: z.strictObject({}),
    runsIn: ECommandRunsIn.Client,
    opens: EClientAction.ModelPicker,
  },
})

const help = defineCommand({
  spec: {
    name: 'help',
    summary: 'List the commands',
    group: ECommandGroup.Session,
    args: z.strictObject({}),
    runsIn: ECommandRunsIn.Client,
    opens: EClientAction.CommandList,
  },
})

const rename = defineCommand({
  spec: {
    name: 'rename',
    summary: 'Rename this session',
    group: ECommandGroup.Session,
    args: z.strictObject({ name: z.string().min(1) }),
    runsIn: ECommandRunsIn.Control,
  },
})

const commands: CommandRegistry = composeCommands([model, help, rename])

describe('clientActionOf', () => {
  it('returns the action of a client command', () => {
    expect(clientActionOf({ text: '/model', commands })).toBe(EClientAction.ModelPicker)
    expect(clientActionOf({ text: '/help', commands })).toBe(EClientAction.CommandList)
  })

  it('returns null for a host or control command', () => {
    expect(clientActionOf({ text: '/rename bench', commands })).toBeNull()
  })

  it('returns null for a message, a refusal and an unknown name', () => {
    expect(clientActionOf({ text: 'hello', commands })).toBeNull()
    expect(clientActionOf({ text: '/model now', commands })).toBeNull()
    expect(clientActionOf({ text: '/nope', commands })).toBeNull()
  })
})

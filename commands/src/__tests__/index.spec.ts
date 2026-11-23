import { describe, expect, it } from 'bun:test'
import { composeCommands, EClientAction, ECommandRunsIn } from '@dltech/atlas-commands'

import { help, model, nativeCommandHandlers, nativeCommands, nativeControlHandlers } from '..'

const CONTROL_HANDLERS_IN_API = new Set(['resize'])

describe('native commands', () => {
  it('compose into a registry without a duplicate', () => {
    const registry = composeCommands(nativeCommands)
    expect([...registry.byName.keys()].sort()).toEqual([
      'help',
      'model',
      'rename',
      'resize',
      'rewind',
      'rotate',
      'summarise',
    ])
  })

  it('has a host handler or a control handler everywhere its runsIn says', () => {
    for (const command of nativeCommands) {
      const hasPodHandler = nativeCommandHandlers.has(command.inboxKind)
      const hasControlHandler = nativeControlHandlers.has(command.spec.name)
      if (command.spec.runsIn === ECommandRunsIn.Host) {
        expect(hasPodHandler).toBe(true)
        expect(hasControlHandler).toBe(false)
      }
      if (command.spec.runsIn === ECommandRunsIn.Control) {
        expect(hasPodHandler).toBe(false)
        expect(hasControlHandler).toBe(!CONTROL_HANDLERS_IN_API.has(command.spec.name))
      }
      if (command.spec.runsIn === ECommandRunsIn.Client) {
        expect(hasPodHandler).toBe(false)
        expect(hasControlHandler).toBe(false)
      }
    }
  })

  it('registers rotate as a host command with an inbox entry', () => {
    const registry = composeCommands(nativeCommands)
    expect(registry.byName.get('rotate')?.spec.runsIn).toBe(ECommandRunsIn.Host)
    expect(registry.byInboxKind.has('command:rotate')).toBe(true)
  })

  it('registers rename as a control command with no inbox entry', () => {
    const registry = composeCommands(nativeCommands)
    expect(registry.byName.get('rename')?.spec.runsIn).toBe(ECommandRunsIn.Control)
    expect(registry.byInboxKind.has('command:rename')).toBe(false)
  })

  it('declares the client commands with the action each opens', () => {
    expect(model.spec.runsIn).toBe(ECommandRunsIn.Client)
    expect(model.spec.opens).toBe(EClientAction.ModelPicker)
    expect(help.spec.runsIn).toBe(ECommandRunsIn.Client)
    expect(help.spec.opens).toBe(EClientAction.CommandList)
  })
})

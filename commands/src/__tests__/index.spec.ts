import { describe, expect, it } from 'bun:test'
import { composeCommands } from '@dltech/atlas-commands'

import { nativeCommandHandlers, nativeCommands, nativeControlHandlers } from '..'

describe('native commands', () => {
  it('compose into a registry without a duplicate', () => {
    const registry = composeCommands(nativeCommands)
    expect(registry.byName.has('rewind')).toBe(true)
  })

  it('has a pod handler for every pod command and a control handler for every control command', () => {
    for (const command of nativeCommands) {
      if (command.spec.handledIn === 'pod') {
        expect(nativeCommandHandlers.has(command.inboxKind)).toBe(true)
        expect(nativeControlHandlers.has(command.spec.name)).toBe(false)
      } else {
        expect(nativeControlHandlers.has(command.spec.name)).toBe(true)
        expect(nativeCommandHandlers.has(command.inboxKind)).toBe(false)
      }
    }
  })

  it('registers rename as a control command', () => {
    const registry = composeCommands(nativeCommands)
    expect(registry.byName.get('rename')?.spec.handledIn).toBe('control')
    expect(registry.byInboxKind.has('command:rename')).toBe(false)
  })
})

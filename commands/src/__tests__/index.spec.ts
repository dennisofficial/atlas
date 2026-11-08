import { describe, expect, it } from 'bun:test'
import { composeCommands } from '@dltech/atlas-commands'

import { nativeCommandHandlers, nativeCommands } from '..'

describe('native commands', () => {
  it('compose into a registry without a duplicate', () => {
    const registry = composeCommands(nativeCommands)
    expect(registry.byName.has('rewind')).toBe(true)
  })

  it('has a handler for every command', () => {
    for (const command of nativeCommands) {
      expect(nativeCommandHandlers.has(command.inboxKind)).toBe(true)
    }
    expect(nativeCommandHandlers.size).toBe(nativeCommands.length)
  })
})

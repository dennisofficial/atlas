import { describe, expect, it } from 'bun:test'
import {
  composeCommands,
  ESurface,
  parseInvocation,
  SURFACE_PROFILES,
} from '@dltech/atlas-commands'

import { nativeCommands } from '..'

const registry = composeCommands(nativeCommands)

describe('surface profiles', () => {
  it('names only commands that this package declares', () => {
    for (const profile of Object.values(SURFACE_PROFILES)) {
      for (const hidden of profile.hides) {
        expect(registry.byName.has(hidden.name)).toBe(true)
      }
      for (const picked of profile.picks) {
        expect(registry.byName.has(picked.name)).toBe(true)
      }
    }
  })

  it('still parses a hidden name, so hiding stays a menu decision', () => {
    for (const surface of Object.values(ESurface)) {
      for (const hidden of SURFACE_PROFILES[surface].hides) {
        const invocation = parseInvocation({
          text: `/${hidden.name}`,
          commands: registry,
          skills: [],
        })
        expect(invocation.kind).not.toBe('message')
      }
    }
  })
})

import { describe, expect, it } from 'bun:test'
import {
  catalogueForSurface,
  composeCommands,
  ECommandSource,
  entryOf,
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

const entries = nativeCommands.map((command) =>
  entryOf({ command, source: ECommandSource.Builtin }),
)

describe('rotate on every surface', () => {
  it('appears in the catalogue for web, mac, mobile and tui', () => {
    for (const surface of Object.values(ESurface)) {
      const names = catalogueForSurface({ entries, surface }).map((entry) => entry.name)
      expect(names).toContain('rotate')
    }
  })

  it('is neither hidden nor picked anywhere', () => {
    for (const profile of Object.values(SURFACE_PROFILES)) {
      expect(profile.hides.map((entry) => entry.name)).not.toContain('rotate')
      expect(profile.picks.map((entry) => entry.name)).not.toContain('rotate')
    }
  })
})

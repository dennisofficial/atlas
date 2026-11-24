import { describe, expect, it } from 'bun:test'
import {
  catalogueForSurface,
  composeCommands,
  ECommandSource,
  EHiddenBecause,
  entryOf,
  ESurface,
  parseInvocation,
  SURFACE_PROFILES,
} from '@dltech/atlas-commands'

import { nativeCommands } from '..'

const registry = composeCommands(nativeCommands)

const nativeHidesOf = (surface: ESurface) => SURFACE_PROFILES[surface].hides

describe('surface profiles', () => {
  it('names only commands that this package declares', () => {
    for (const surface of Object.values(ESurface)) {
      for (const hidden of nativeHidesOf(surface)) {
        expect(registry.byName.has(hidden.name)).toBe(true)
      }
      for (const picked of SURFACE_PROFILES[surface].picks) {
        expect(registry.byName.has(picked.name)).toBe(true)
      }
    }
  })

  it('still parses a hidden name, so hiding stays a menu decision', () => {
    for (const surface of Object.values(ESurface)) {
      for (const hidden of nativeHidesOf(surface)) {
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

const namesOn = (surface: ESurface): readonly string[] =>
  catalogueForSurface({ entries, surface }).map((entry) => entry.name)

describe('the panel commands', () => {
  it('are hidden on web, mac and mobile because only the app draws their panel', () => {
    for (const surface of [ESurface.Web, ESurface.Mac, ESurface.Mobile]) {
      const names = namesOn(surface)
      for (const name of ['skills', 'mcp', 'shells']) expect(names).not.toContain(name)
      for (const name of ['skills', 'mcp', 'shells']) {
        expect(SURFACE_PROFILES[surface].hides).toContainEqual({
          name,
          because: EHiddenBecause.Panel,
        })
      }
    }
  })

  it('stay in the tui catalogue', () => {
    const names = namesOn(ESurface.Tui)
    for (const name of ['skills', 'mcp', 'shells']) expect(names).toContain(name)
  })
})

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

import { describe, expect, it } from 'bun:test'
import { ECommandEntryKind, ECommandSource, type CommandEntry } from '../entry'
import { ECommandGroup } from '../spec'
import { catalogueForSurface, EHiddenBecause, ESurface, SURFACE_PROFILES } from '../surface'

const entry = (name: string, group: ECommandGroup): CommandEntry => ({
  name,
  summary: `${name} summary`,
  group,
  kind: ECommandEntryKind.Command,
  source: ECommandSource.Builtin,
})

const entries: readonly CommandEntry[] = [
  entry('rewind', ECommandGroup.Context),
  entry('summarise', ECommandGroup.Context),
  entry('rename', ECommandGroup.Session),
]

const namesOf = (surface: ESurface): readonly string[] =>
  catalogueForSurface({ entries, surface }).map((command) => command.name)

describe('catalogueForSurface', () => {
  it('hides summarise and picks rewind on the tui', () => {
    expect(namesOf(ESurface.Tui)).toEqual(['rewind', 'rename'])
    expect(SURFACE_PROFILES[ESurface.Tui].picks).toEqual([{ name: 'rewind' }])
    expect(SURFACE_PROFILES[ESurface.Tui].hides).toEqual([
      { name: 'summarise', because: EHiddenBecause.MessageAction },
    ])
  })

  it.each([ESurface.Web, ESurface.Mac, ESurface.Mobile])(
    'hides rewind and summarise on %p and picks nothing',
    (surface) => {
      expect(namesOf(surface)).toEqual(['rename'])
      expect(SURFACE_PROFILES[surface].picks).toEqual([])
    },
  )
})

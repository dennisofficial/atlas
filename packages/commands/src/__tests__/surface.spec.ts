import { describe, expect, it } from 'bun:test'

import { ECommandEntryKind, ECommandSource, type CommandEntry } from '../entry'
import { composeCommands, defineCommand } from '../registry'
import { ECommandGroup, ECommandRunsIn } from '../spec'
import { catalogueForSurface, EHiddenBecause, ESurface, SURFACE_PROFILES } from '../surface'
import { EInvocation, parseInvocation } from '../text'
import { z } from 'zod'

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

  it('still resolves a typed command that no surface lists', () => {
    const agent = defineCommand({
      spec: {
        name: 'agent',
        summary: 'Message or stop a sub-agent',
        group: ECommandGroup.Session,
        args: z.strictObject({ action: z.string(), agentId: z.string() }),
        runsIn: ECommandRunsIn.Host,
        fromText: (argumentText) => {
          const [action, agentId] = argumentText.trim().split(/\s+/)
          return { ok: true, args: { action, agentId } }
        },
        listed: false,
      },
    })
    const parsed = parseInvocation({
      text: '/agent stop a1',
      commands: composeCommands([agent]),
      skills: [],
    })
    expect(parsed).toMatchObject({
      kind: EInvocation.Command,
      command: { spec: { name: 'agent' } },
      args: { action: 'stop', agentId: 'a1' },
    })
  })
})

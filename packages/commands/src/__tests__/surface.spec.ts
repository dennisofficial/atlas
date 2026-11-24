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

const PANE_ACTION_NAMES = ['agent', 'shell-kill', 'service'] as const

const entries: readonly CommandEntry[] = [
  entry('rewind', ECommandGroup.Context),
  entry('summarise', ECommandGroup.Context),
  entry('rename', ECommandGroup.Session),
  ...PANE_ACTION_NAMES.map((name) => entry(name, ECommandGroup.Session)),
]

const namesOf = (surface: ESurface): readonly string[] =>
  catalogueForSurface({ entries, surface }).map((command) => command.name)

const surfaces: readonly ESurface[] = [ESurface.Tui, ESurface.Web, ESurface.Mac, ESurface.Mobile]

describe('catalogueForSurface', () => {
  it('hides summarise and picks rewind on the tui', () => {
    expect(namesOf(ESurface.Tui)).toEqual(['rewind', 'rename'])
    expect(SURFACE_PROFILES[ESurface.Tui].picks).toEqual([{ name: 'rewind' }])
    expect(SURFACE_PROFILES[ESurface.Tui].hides).toEqual([
      { name: 'summarise', because: EHiddenBecause.MessageAction },
      { name: 'agent', because: EHiddenBecause.PaneAction },
      { name: 'shell-kill', because: EHiddenBecause.PaneAction },
      { name: 'service', because: EHiddenBecause.PaneAction },
    ])
  })

  it.each([ESurface.Web, ESurface.Mac, ESurface.Mobile])(
    'hides rewind and summarise on %p and picks nothing',
    (surface) => {
      expect(namesOf(surface)).toEqual(['rename'])
      expect(SURFACE_PROFILES[surface].picks).toEqual([])
    },
  )

  it.each(surfaces)('hides every pane action on %p', (surface) => {
    for (const name of PANE_ACTION_NAMES) {
      expect(namesOf(surface)).not.toContain(name)
    }
    expect(
      SURFACE_PROFILES[surface].hides.filter(
        (hidden) => hidden.because === EHiddenBecause.PaneAction,
      ),
    ).toEqual(PANE_ACTION_NAMES.map((name) => ({ name, because: EHiddenBecause.PaneAction })))
  })

  it('still runs a pane action that is typed', () => {
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

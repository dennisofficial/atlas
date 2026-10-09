import { describe, expect, it } from 'bun:test'

import { log } from '../../assembly/__tests__/log-fixture'
import type { EventDraft } from '../../events/body'
import type { Event } from '../../events/envelope'
import { EContextSlot } from '../slot'
import { currentContextEvents, supersededContextIds } from '../supersede'

const loaded = (args: { slot: string; key: string; content: string }): EventDraft => ({
  type: 'context-loaded',
  slot: args.slot,
  key: args.key,
  content: args.content,
})

const idsOf = (events: readonly Event[]): string[] => events.map((event) => event.id)

describe('currentContextEvents', () => {
  it('keeps a lone entry', () => {
    const events = log([loaded({ slot: EContextSlot.ProjectInstructions, key: '/repo/CLAUDE.md', content: 'a' })])

    expect(idsOf([...currentContextEvents(events)])).toEqual(['event-1'])
  })

  it('keeps only the latest entry when a file is loaded again with new content', () => {
    const events = log([
      loaded({ slot: EContextSlot.ProjectInstructions, key: '/repo/CLAUDE.md', content: 'old' }),
      { type: 'user-said', text: 'hi' },
      loaded({ slot: EContextSlot.ProjectInstructions, key: '/repo/CLAUDE.md', content: 'new' }),
    ])

    const current = [...currentContextEvents(events)]

    expect(idsOf(current)).toEqual(['event-3'])
    expect(current[0]).toMatchObject({ content: 'new' })
  })

  it('keeps distinct files apart', () => {
    const events = log([
      loaded({ slot: EContextSlot.ProjectInstructions, key: '/repo/CLAUDE.md', content: 'a' }),
      loaded({ slot: EContextSlot.ProjectInstructions, key: '/repo/AGENTS.md', content: 'b' }),
    ])

    expect(idsOf([...currentContextEvents(events)])).toEqual(['event-1', 'event-2'])
  })

  it('treats the same file reloaded at a moved path as one entry, the relocation case', () => {
    const events = log([
      loaded({ slot: EContextSlot.ProjectInstructions, key: '/Users/d/Developer/comp-v2/CLAUDE.md', content: 'same bytes' }),
      { type: 'user-said', text: 'hi' },
      loaded({ slot: EContextSlot.ProjectInstructions, key: '/atlas/workspaces/comp-v2/CLAUDE.md', content: 'same bytes' }),
    ])

    const current = [...currentContextEvents(events)]

    expect(idsOf(current)).toEqual(['event-3'])
    expect(current[0]).toMatchObject({ key: '/atlas/workspaces/comp-v2/CLAUDE.md' })
  })

  it('supersedes the moved-path original even when the reload is byte-identical', () => {
    const events = log([
      loaded({ slot: EContextSlot.ProjectInstructions, key: '/repo/CLAUDE.md', content: 'same bytes' }),
      loaded({ slot: EContextSlot.ProjectInstructions, key: '/moved/CLAUDE.md', content: 'same bytes' }),
    ])

    expect([...supersededContextIds(events)]).toEqual(['event-1'])
  })

  it('keeps two same-named files with different content both current, the monorepo case', () => {
    const events = log([
      loaded({ slot: EContextSlot.NestedInstructions, key: '/repo/apps/api/AGENTS.md', content: 'api rules' }),
      loaded({ slot: EContextSlot.NestedInstructions, key: '/repo/apps/app/AGENTS.md', content: 'app rules' }),
    ])

    expect(idsOf([...currentContextEvents(events)])).toEqual(['event-1', 'event-2'])
  })

  it('keeps the same filename apart across slots after a move', () => {
    const events = log([
      loaded({ slot: EContextSlot.ProjectInstructions, key: '/repo/CLAUDE.md', content: 'a' }),
      loaded({ slot: EContextSlot.NestedInstructions, key: '/moved/CLAUDE.md', content: 'a' }),
    ])

    expect(idsOf([...currentContextEvents(events)])).toEqual(['event-1', 'event-2'])
  })

  it('keeps the same key apart across slots', () => {
    const events = log([
      loaded({ slot: EContextSlot.ProjectInstructions, key: '/repo/CLAUDE.md', content: 'a' }),
      loaded({ slot: EContextSlot.NestedInstructions, key: '/repo/CLAUDE.md', content: 'b' }),
    ])

    expect(idsOf([...currentContextEvents(events)])).toEqual(['event-1', 'event-2'])
  })

  it('returns the survivors in log order, not in order of first appearance', () => {
    const events = log([
      loaded({ slot: EContextSlot.ProjectInstructions, key: '/a', content: '1' }),
      loaded({ slot: EContextSlot.ProjectInstructions, key: '/b', content: '2' }),
      loaded({ slot: EContextSlot.ProjectInstructions, key: '/a', content: '3' }),
    ])

    expect(idsOf([...currentContextEvents(events)])).toEqual(['event-2', 'event-3'])
  })

  it('ignores every event that is not context-loaded', () => {
    const events = log([
      { type: 'user-said', text: 'hi' },
      { type: 'nudge', text: 'keep going', lifetimeSteps: 1 },
    ])

    expect([...currentContextEvents(events)]).toEqual([])
  })
})

import { EContextSlot, toEventId, toRunId, toThreadId, type Event } from '@dltech/atlas-core'
import { describe, expect, it } from 'vitest'

import { durableEntries } from '../durable-entries'
import { EEntryKind, type SystemContextEntry, type SystemNoticeEntry } from '../transcript-model'

const LEGACY_MEMORY = '/home/me/.atlas/memory/MEMORY.md'

let seq = 0

const envelope = () => {
  seq += 1
  return {
    id: toEventId(`e${seq}`),
    seq,
    threadId: toThreadId('t'),
    runId: toRunId('r'),
    depth: 0,
    at: '2026-08-27T00:00:00.000Z',
  }
}

const contextLoaded = (args: { slot: string; key: string; content: string }): Event =>
  ({ ...envelope(), type: 'context-loaded', ...args }) as Event

const said = (text: string): Event => ({ ...envelope(), type: 'user-said', text })

const nudge = (text: string): Event => ({ ...envelope(), type: 'nudge', text, lifetimeSteps: 3 })

const systemContexts = (events: readonly Event[]): SystemContextEntry[] =>
  durableEntries({ events }).filter(
    (entry): entry is SystemContextEntry => entry.kind === EEntryKind.SystemContext,
  )

const systemNotices = (events: readonly Event[]): SystemNoticeEntry[] =>
  durableEntries({ events }).filter(
    (entry): entry is SystemNoticeEntry => entry.kind === EEntryKind.SystemNotice,
  )

describe('system context entries', () => {
  it('names a hook injection by identity, not a content preview', () => {
    const entries = systemContexts([
      contextLoaded({
        slot: 'skill-suggestion',
        key: 'additional-context',
        content:
          '<skill_relevance>\n' +
          "The skill classifier picked 'aws-deployment' as relevant to the user's latest request. " +
          'Load it with the skill tool when it genuinely applies; if it does not, ignore this entirely.\n' +
          '</skill_relevance>',
      }),
    ])

    expect(entries).toHaveLength(1)
    expect(entries[0]?.items).toHaveLength(1)
    expect(entries[0]?.text).toBe('skill suggestion · aws-deployment')
    expect(entries[0]?.items[0]?.label).toBe('skill suggestion · aws-deployment')
    expect(entries[0]?.items[0]?.content).toContain('aws-deployment')
    expect(entries[0]?.items[0]?.superseded).toBe(false)
  })

  it('labels known slots by name', () => {
    const entries = systemContexts([
      contextLoaded({ slot: EContextSlot.UserInstructions, key: '/home/.atlas/ATLAS.md', content: 'x' }),
      contextLoaded({ slot: EContextSlot.ProjectInstructions, key: '/repo/CLAUDE.md', content: 'x' }),
      contextLoaded({ slot: 'memory', key: LEGACY_MEMORY, content: 'x' }),
    ])

    expect(entries).toHaveLength(1)
    expect(entries[0]?.items.map((item) => item.label)).toEqual([
      'global instructions',
      'project instructions',
      'memory',
    ])
  })

  it('aggregates a run of consecutive loads into one entry', () => {
    const entries = systemContexts([
      contextLoaded({ slot: EContextSlot.UserInstructions, key: 'a', content: 'a' }),
      contextLoaded({ slot: EContextSlot.ProjectInstructions, key: 'b', content: 'b' }),
      contextLoaded({ slot: 'memory', key: 'c', content: 'c' }),
      contextLoaded({ slot: 'memory', key: 'd', content: 'd' }),
      contextLoaded({ slot: 'skill-suggestion', key: 'e', content: 'e' }),
    ])

    expect(entries).toHaveLength(1)
    expect(entries[0]?.items).toHaveLength(5)
    expect(entries[0]?.text).toBe('5 prompts')
  })

  it('splits two runs when another event sits between them', () => {
    const first = contextLoaded({ slot: EContextSlot.UserInstructions, key: 'a', content: 'a' })
    const second = contextLoaded({ slot: 'memory', key: LEGACY_MEMORY, content: 'b' })
    const third = contextLoaded({ slot: 'memory', key: LEGACY_MEMORY, content: 'c' })
    const entries = systemContexts([first, second, said('hello'), third])

    expect(entries).toHaveLength(2)
    expect(entries[0]?.items).toHaveLength(2)
    expect(entries[0]?.key).toBe(first.id)
    expect(entries[1]?.items).toHaveLength(1)
    expect(entries[1]?.text).toBe('memory')
  })

  it('marks an injection superseded when a newer event shares its slot and key', () => {
    const entries = systemContexts([
      contextLoaded({ slot: 'memory', key: '/m/MEMORY.md', content: 'old index' }),
      contextLoaded({ slot: 'memory', key: '/m/MEMORY.md', content: 'new index' }),
    ])

    expect(entries[0]?.items[0]?.superseded).toBe(true)
    expect(entries[0]?.items[1]?.superseded).toBe(false)
  })

  it('renders instruction loads that arrive before any tool call', () => {
    const entries = systemContexts([
      contextLoaded({
        slot: EContextSlot.ProjectInstructions,
        key: '/repo/CLAUDE.md',
        content: '# rules',
      }),
    ])

    expect(entries).toHaveLength(1)
  })

  it('does not double-render a skill that folds into the operator bubble', () => {
    const entries = systemContexts([
      contextLoaded({ slot: EContextSlot.Skill, key: 'pirate', content: 'body' }),
      said('/pirate hello'),
    ])

    expect(entries).toHaveLength(0)
  })

  it('still renders a skill load no message ever claims', () => {
    const entries = systemContexts([
      contextLoaded({ slot: EContextSlot.Skill, key: 'pirate', content: 'body' }),
    ])

    expect(entries).toHaveLength(1)
  })

  it('keeps a folded skill load from breaking the run around it', () => {
    const entries = systemContexts([
      contextLoaded({ slot: EContextSlot.UserInstructions, key: 'a', content: 'a' }),
      contextLoaded({ slot: EContextSlot.Skill, key: 'pirate', content: 'body' }),
      contextLoaded({ slot: 'memory', key: 'c', content: 'c' }),
    ])

    expect(entries).toHaveLength(1)
    expect(entries[0]?.items).toHaveLength(3)
  })

  it('labels a legacy session-slot injection by its slot', () => {
    const entries = systemContexts([
      contextLoaded({
        slot: 'session',
        key: 'workspace-note',
        content: 'The workspace landed at /atlas/workspaces/repo.',
      }),
    ])

    expect(entries).toHaveLength(1)
    expect(entries[0]?.items[0]?.label).toBe('session')
  })
})

describe('system notice entries', () => {
  it('renders a nudge with a preview and the full text as the expandable body', () => {
    const entries = systemNotices([nudge('Loop-watch: you have made no progress in 3 steps.')])

    expect(entries).toHaveLength(1)
    expect(entries[0]?.text).toContain('nudge')
    expect(entries[0]?.content).toContain('no progress')
  })
})

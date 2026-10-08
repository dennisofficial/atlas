import { EContextSlot, toEventId, toRunId, toThreadId, type Event } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { durableEntries } from '../durable-entries'
import { EEntryKind, type SystemContextEntry, type SystemNoticeEntry } from '../transcript-model'

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
  it('renders a hook injection with its slot and a preview line', () => {
    const entries = systemContexts([
      contextLoaded({
        slot: 'skill-suggestion',
        key: 'additional-context',
        content: '<skill_relevance>\nRelevant to the current request: aws-deployment.\n</skill_relevance>',
      }),
    ])

    expect(entries).toHaveLength(1)
    expect(entries[0]?.slot).toBe('skill-suggestion')
    expect(entries[0]?.text).toContain('skill-suggestion')
    expect(entries[0]?.content).toContain('aws-deployment')
    expect(entries[0]?.superseded).toBe(false)
  })

  it('marks an injection superseded when a newer event shares its slot and key', () => {
    const entries = systemContexts([
      contextLoaded({ slot: 'memory', key: '/m/MEMORY.md', content: 'old index' }),
      contextLoaded({ slot: 'memory', key: '/m/MEMORY.md', content: 'new index' }),
    ])

    expect(entries[0]?.superseded).toBe(true)
    expect(entries[1]?.superseded).toBe(false)
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
})

describe('system notice entries', () => {
  it('renders a nudge with a preview and the full text as the expandable body', () => {
    const entries = systemNotices([nudge('Loop-watch: you have made no progress in 3 steps.')])

    expect(entries).toHaveLength(1)
    expect(entries[0]?.text).toContain('nudge')
    expect(entries[0]?.content).toContain('no progress')
  })
})

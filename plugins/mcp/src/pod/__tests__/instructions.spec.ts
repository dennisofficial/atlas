import { EContextSlot, type V2Event } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { mcpInstructionsDraftsOf } from '../instructions'
import { eventOf } from './recording'

const offer = (content: string, key = 'docs') => ({
  type: 'context-loaded' as const,
  slot: EContextSlot.McpInstructions,
  key,
  content,
})

const recorded = (...drafts: readonly object[]): readonly V2Event[] =>
  drafts.map((draft, index) => eventOf(draft, index + 1))

describe('mcpInstructionsDraftsOf', () => {
  it('offers a server instructions the first time it has any', () => {
    expect(
      mcpInstructionsDraftsOf({ events: [], next: new Map([['docs', 'Docs first.']]) }),
    ).toEqual([offer('Docs first.')])
  })

  it('does not offer the same instructions twice', () => {
    expect(
      mcpInstructionsDraftsOf({
        events: recorded(offer('Docs first.')),
        next: new Map([['docs', 'Docs first.']]),
      }),
    ).toEqual([])
  })

  it('offers instructions again when they change', () => {
    expect(
      mcpInstructionsDraftsOf({
        events: recorded(offer('Old.')),
        next: new Map([['docs', 'New.']]),
      }),
    ).toEqual([offer('New.')])
  })

  it('tombstones a server that leaves', () => {
    expect(
      mcpInstructionsDraftsOf({ events: recorded(offer('Docs first.')), next: new Map() }),
    ).toEqual([offer('')])
  })

  it('tombstones a server that left while no host held the session, from the record alone', () => {
    expect(
      mcpInstructionsDraftsOf({
        events: recorded(offer('Docs first.'), offer('Paper first.', 'paper')),
        next: new Map([['paper', 'Paper first.']]),
      }),
    ).toEqual([offer('')])
  })

  it('does not tombstone a server twice', () => {
    expect(
      mcpInstructionsDraftsOf({
        events: recorded(offer('Docs first.'), offer('')),
        next: new Map(),
      }),
    ).toEqual([])
  })

  it('offers a server again after its tombstone', () => {
    expect(
      mcpInstructionsDraftsOf({
        events: recorded(offer('Docs first.'), offer('')),
        next: new Map([['docs', 'Docs first.']]),
      }),
    ).toEqual([offer('Docs first.')])
  })

  it('ignores context from other slots', () => {
    expect(
      mcpInstructionsDraftsOf({
        events: recorded({ ...offer('Skill.'), slot: EContextSlot.Skill }),
        next: new Map(),
      }),
    ).toEqual([])
  })
})

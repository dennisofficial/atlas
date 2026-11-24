import { EContextSlot, EDefinitionOrigin, type V2Event } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { mcpInstructionsDraftsOf } from '../instructions'
import { EMcpServerStatus, type McpServerTools } from '../snapshot'
import { eventOf } from './recording'

const offer = (content: string, key = 'docs') => ({
  type: 'context-loaded' as const,
  slot: EContextSlot.McpInstructions,
  key,
  content,
})

const recorded = (...drafts: readonly object[]): readonly V2Event[] =>
  drafts.map((draft, index) => eventOf(draft, index + 1))

const serverOf = (
  name: string,
  status: EMcpServerStatus,
  instructions?: string,
): McpServerTools => ({
  name,
  origin: EDefinitionOrigin.User,
  transportKind: 'http',
  configHash: 'c1',
  status,
  tools: [],
  ...(instructions === undefined ? {} : { instructions }),
})

describe('mcpInstructionsDraftsOf', () => {
  it('offers a server its instructions the first time it connects with any', () => {
    expect(
      mcpInstructionsDraftsOf({
        events: [],
        servers: [serverOf('docs', EMcpServerStatus.Connected, 'Docs first.')],
      }),
    ).toEqual([offer('Docs first.')])
  })

  it('does not offer the same instructions twice', () => {
    expect(
      mcpInstructionsDraftsOf({
        events: recorded(offer('Docs first.')),
        servers: [serverOf('docs', EMcpServerStatus.Connected, 'Docs first.')],
      }),
    ).toEqual([])
  })

  it('offers instructions again when they change', () => {
    expect(
      mcpInstructionsDraftsOf({
        events: recorded(offer('Old.')),
        servers: [serverOf('docs', EMcpServerStatus.Connected, 'New.')],
      }),
    ).toEqual([offer('New.')])
  })

  it.each([
    ['needs-auth', EMcpServerStatus.NeedsAuth],
    ['failed', EMcpServerStatus.Failed],
    ['unavailable', EMcpServerStatus.Unavailable],
  ])('keeps the offered instructions of a %s server', (_label, status) => {
    expect(
      mcpInstructionsDraftsOf({
        events: recorded(offer('Docs first.')),
        servers: [serverOf('docs', status)],
      }),
    ).toEqual([])
  })

  it('tombstones a server that leaves the config', () => {
    expect(
      mcpInstructionsDraftsOf({ events: recorded(offer('Docs first.')), servers: [] }),
    ).toEqual([offer('')])
  })

  it('tombstones a server that left while no host held the session, from the record alone', () => {
    expect(
      mcpInstructionsDraftsOf({
        events: recorded(offer('Docs first.'), offer('Paper first.', 'paper')),
        servers: [serverOf('paper', EMcpServerStatus.Connected, 'Paper first.')],
      }),
    ).toEqual([offer('')])
  })

  it('tombstones a connected server that stopped carrying instructions', () => {
    expect(
      mcpInstructionsDraftsOf({
        events: recorded(offer('Docs first.')),
        servers: [serverOf('docs', EMcpServerStatus.Connected)],
      }),
    ).toEqual([offer('')])
  })

  it('does not tombstone a server twice', () => {
    expect(
      mcpInstructionsDraftsOf({ events: recorded(offer('Docs first.'), offer('')), servers: [] }),
    ).toEqual([])
  })

  it('offers a server again after its tombstone', () => {
    expect(
      mcpInstructionsDraftsOf({
        events: recorded(offer('Docs first.'), offer('')),
        servers: [serverOf('docs', EMcpServerStatus.Connected, 'Docs first.')],
      }),
    ).toEqual([offer('Docs first.')])
  })

  it('ignores context from other slots', () => {
    expect(
      mcpInstructionsDraftsOf({
        events: recorded({ ...offer('Skill.'), slot: EContextSlot.Skill }),
        servers: [],
      }),
    ).toEqual([])
  })
})

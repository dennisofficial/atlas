import { EContextSlot } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { mcpInstructionsDraftsOf } from '../instructions'

const offer = (content: string) => ({
  type: 'context-loaded' as const,
  slot: EContextSlot.McpInstructions,
  key: 'docs',
  content,
})

describe('mcpInstructionsDraftsOf', () => {
  it('offers a server instructions the first time it has any', () => {
    expect(
      mcpInstructionsDraftsOf({
        previous: new Map(),
        next: new Map([['docs', 'Docs first.']]),
      }),
    ).toEqual([offer('Docs first.')])
  })

  it('does not offer the same instructions twice', () => {
    expect(
      mcpInstructionsDraftsOf({
        previous: new Map([['docs', 'Docs first.']]),
        next: new Map([['docs', 'Docs first.']]),
      }),
    ).toEqual([])
  })

  it('offers instructions again when they change', () => {
    expect(
      mcpInstructionsDraftsOf({
        previous: new Map([['docs', 'Old.']]),
        next: new Map([['docs', 'New.']]),
      }),
    ).toEqual([offer('New.')])
  })

  it('tombstones a server that leaves', () => {
    expect(
      mcpInstructionsDraftsOf({ previous: new Map([['docs', 'Docs first.']]), next: new Map() }),
    ).toEqual([offer('')])
  })
})

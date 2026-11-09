import { EContextSlot, toThreadId } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { mcpInstructionsOf } from '../instructions'

const thread = toThreadId('t1')

describe('mcpInstructionsOf', () => {
  it('offers a connected server instructions once', () => {
    const offered = new Set<string>()
    const drafts = mcpInstructionsOf({ live: new Map([['docs', 'Docs first.']]), offered })
    expect(drafts).toEqual([
      {
        type: 'context-loaded',
        slot: EContextSlot.McpInstructions,
        key: 'docs',
        content: 'Docs first.',
      },
    ])
    expect(offered.has('docs')).toBe(true)
  })

  it('does not offer the same server again on the next turn', () => {
    const offered = new Set<string>(['docs'])
    expect(mcpInstructionsOf({ live: new Map([['docs', 'Docs first.']]), offered })).toEqual([])
  })

  it('tombstones a server that leaves', () => {
    const offered = new Set<string>(['docs'])
    expect(mcpInstructionsOf({ live: new Map(), offered })).toEqual([
      { type: 'context-loaded', slot: EContextSlot.McpInstructions, key: 'docs', content: '' },
    ])
    expect(offered.has('docs')).toBe(false)
  })

  it('offers a server again after it reconnects', () => {
    const offered = new Set<string>(['docs'])
    mcpInstructionsOf({ live: new Map(), offered })
    expect(mcpInstructionsOf({ live: new Map([['docs', 'Docs first.']]), offered })).toHaveLength(1)
  })

  it('offers each thread its own copy, through the hook', async () => {
    const hook = (await import('../instructions')).mcpInstructionsHook({
      store: { instructionsByServer: () => new Map([['docs', 'Docs first.']]) } as never,
      offered: new Map(),
    })
    const first = await hook.run({ threadId: thread, projectDirectory: '/repo' })
    const second = await hook.run({ threadId: thread, projectDirectory: '/repo' })
    expect(first.drafts).toHaveLength(1)
    expect(second).toEqual({})
  })
})

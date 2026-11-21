import { describe, expect, it } from 'bun:test'

import { DEFERRED_TOOLS_SOURCE, EToolEffect, type Assembled } from '@dltech/atlas-core'
import { z } from 'zod'

import { deferredListingHook } from '../deferred-listing'

const assembled: Assembled = { system: [], messages: [] }

const deferred = (
  name: string,
): {
  name: string
  description: string
  effect: EToolEffect
  deferred: true
  inputSchema: z.ZodType
} => ({
  name,
  description: `${name} does something`,
  effect: EToolEffect.Read,
  deferred: true,
  inputSchema: z.object({}),
})

const runner = (names: readonly string[]) =>
  deferredListingHook({ declarations: () => names.map((name) => deferred(name)) })

describe('the host deferred listing hook', () => {
  it('appends one system block that says how to run them, then the names by group', async () => {
    const next = await runner(['mcp__docs__search', 'mcp__events__list', 'routine']).run({
      assembled,
      trace: [],
    })

    expect(next.system).toHaveLength(1)
    expect(next.system[0]?.source).toBe(DEFERRED_TOOLS_SOURCE)
    const text = next.system[0]?.text ?? ''
    expect(text).toContain('These tools are available but not loaded.')
    expect(text).toContain('call tool_search')
    expect(text).toContain('use call_tool')
    expect(text).toContain('docs: mcp__docs__search')
    expect(text).toContain('events: mcp__events__list')
    expect(text).toContain('atlas: routine')
  })

  it('adds nothing when no tool is deferred', async () => {
    const eager = {
      name: 'read',
      description: 'Read a file',
      effect: EToolEffect.Read,
      inputSchema: z.object({}),
    }
    const hook = deferredListingHook({ declarations: () => [eager] })

    expect(await hook.run({ assembled, trace: [] })).toBe(assembled)
  })
})

import { describe, expect, it } from 'bun:test'
import { z } from 'zod'

import { toEventId } from '../../events/ids'
import type { Message } from '../../message/message'
import { EToolEffect, type ToolDeclaration } from '../../tools/tool'
import type { Assembled } from '../assembled'
import { requestSizeOf } from '../request-size'

const ORIGIN = { eventId: toEventId('event-under-test'), seq: 1 }

const tool = (args: {
  name: string
  description: string
  inputSchema: ToolDeclaration['inputSchema']
  jsonSchema?: unknown
}): ToolDeclaration => ({
  name: args.name,
  description: args.description,
  effect: EToolEffect.Read,
  inputSchema: args.inputSchema,
  ...(args.jsonSchema === undefined ? {} : { jsonSchema: args.jsonSchema }),
})

const userMessage = (text: string): Message => ({
  role: 'user',
  content: [{ type: 'text', text }],
})

const assembledWith = (args: {
  system: Assembled['system']
  messages?: readonly Message[]
}): Assembled => ({
  system: args.system,
  messages: (args.messages ?? []).map((message) => ({ message, origin: ORIGIN })),
})

describe('requestSizeOf', () => {
  it('counts each system block under its source, and unsourced blocks under other', () => {
    const sizes = requestSizeOf({
      assembled: assembledWith({
        system: [
          { text: 'abc', source: 'system-prompt' },
          { text: 'de', source: 'instructions' },
          { text: 'fghi' },
        ],
      }),
      tools: [],
    })

    expect(sizes['system.system-prompt']).toBe(3)
    expect(sizes['system.instructions']).toBe(2)
    expect(sizes['system.other']).toBe(4)
    expect(sizes.system).toBeUndefined()
  })

  it('sums blocks that name the same source', () => {
    const sizes = requestSizeOf({
      assembled: assembledWith({
        system: [
          { text: 'abc', source: 'instructions' },
          { text: 'de', source: 'instructions' },
        ],
      }),
      tools: [],
    })

    expect(sizes['system.instructions']).toBe(5)
  })

  it('sizes each prompt fragment named on a system block, inside its block total', () => {
    const sizes = requestSizeOf({
      assembled: assembledWith({
        system: [
          {
            text: 'abcdef',
            source: 'system-prompt',
            parts: [
              { id: 'identity.atlas', chars: 2 },
              { id: 'skills.listing', chars: 4 },
            ],
          },
        ],
      }),
      tools: [],
    })

    expect(sizes['system.prompt.identity.atlas']).toBe(2)
    expect(sizes['system.prompt.skills.listing']).toBe(4)
    expect(sizes['system.system-prompt']).toBe(6)
    expect(sizes.total).toBe(6)
  })

  it('splits tool declarations into builtin and one bucket per MCP server, with counts', () => {
    const sizes = requestSizeOf({
      assembled: assembledWith({ system: [] }),
      tools: [
        tool({ name: 'read', description: 'reads', inputSchema: z.object({ path: z.string() }) }),
        tool({
          name: 'mcp__a__x',
          description: 'ay',
          inputSchema: z.object({ one: z.string() }),
        }),
        tool({
          name: 'mcp__b__y',
          description: 'bee',
          inputSchema: z.object({ two: z.string() }),
        }),
        tool({
          name: 'mcp__a__z',
          description: 'zed',
          inputSchema: z.object({ three: z.string() }),
        }),
      ],
    })

    expect(sizes['tools.builtin.count']).toBe(1)
    expect(sizes['tools.mcp.a.count']).toBe(2)
    expect(sizes['tools.mcp.b.count']).toBe(1)
    expect(sizes['tools.builtin']).toBeGreaterThan('reads'.length)
    expect(sizes['tools.mcp.a']).toBeGreaterThan('ay'.length + 'zed'.length)
    expect(sizes['tools.mcp.b']).toBeGreaterThan('bee'.length)
  })

  it('measures the raw json schema when the declaration carries one', () => {
    const jsonSchema = { type: 'object', properties: { q: { type: 'string' } } }
    const sizes = requestSizeOf({
      assembled: assembledWith({ system: [] }),
      tools: [
        tool({
          name: 'read',
          description: '',
          inputSchema: z.object({ ignored: z.string() }),
          jsonSchema,
        }),
      ],
    })

    expect(sizes['tools.builtin']).toBe(JSON.stringify(jsonSchema).length)
  })

  it('counts message text, tool-call inputs and tool-result outputs', () => {
    const sizes = requestSizeOf({
      assembled: assembledWith({
        system: [],
        messages: [
          userMessage('hello'),
          {
            role: 'assistant',
            content: [
              { type: 'reasoning', text: 'why' },
              { type: 'text', text: 'done' },
              { type: 'tool-call', toolCallId: 'c1', toolName: 'read', input: { path: 'a' } },
            ],
          },
          {
            role: 'tool',
            content: [
              {
                type: 'tool-result',
                toolCallId: 'c1',
                toolName: 'read',
                output: { type: 'text', value: 'contents' },
              },
            ],
          },
        ],
      }),
      tools: [],
    })

    const call = JSON.stringify({ path: 'a' }).length

    expect(sizes.messages).toBe('hello'.length + 'why'.length + 'done'.length + call + 8)
    expect(sizes['messages.tool-results']).toBe(8)
  })

  it('attributes a user text part carrying a system-context envelope to that source', () => {
    const sizes = requestSizeOf({
      assembled: assembledWith({
        system: [],
        messages: [
          userMessage(
            '<system-context source="mcp-instructions">\nuse the tool\n</system-context>',
          ),
          userMessage('plain words'),
        ],
      }),
      tools: [],
    })

    expect(sizes['messages.context.mcp-instructions']).toBe(
      '<system-context source="mcp-instructions">\nuse the tool\n</system-context>'.length,
    )
    expect(sizes.messages).toBe(sizes['messages.context.mcp-instructions']! + 'plain words'.length)
  })

  it('totals the system, tool and message characters', () => {
    const sizes = requestSizeOf({
      assembled: assembledWith({
        system: [{ text: 'abc', source: 'system-prompt' }],
        messages: [userMessage('de')],
      }),
      tools: [tool({ name: 'read', description: 'r', inputSchema: z.object({}) })],
    })

    expect(sizes.total).toBe(sizes['system.system-prompt']! + sizes['tools.builtin']! + 2)
    expect(sizes.total).toBeGreaterThan(0)
  })

  it('keeps no counts in the total', () => {
    const sizes = requestSizeOf({
      assembled: assembledWith({ system: [] }),
      tools: [tool({ name: 'read', description: 'r', inputSchema: z.object({}) })],
    })

    const counts = Object.entries(sizes)
      .filter(([key]) => key.endsWith('.count'))
      .reduce((sum, [, value]) => sum + value, 0)

    expect(counts).toBe(1)
    expect(sizes.total).toBe(sizes['tools.builtin']!)
  })

  it('keys every entry by name only, never by prompt content', () => {
    const sizes = requestSizeOf({
      assembled: assembledWith({
        system: [{ text: 'a very secret doctrine', source: 'system-prompt' }],
        messages: [userMessage('something the operator typed')],
      }),
      tools: [tool({ name: 'mcp__server__tool', description: 'd', inputSchema: z.object({}) })],
    })

    expect(Object.keys(sizes).every((key) => !key.includes(' '))).toBe(true)
  })
})

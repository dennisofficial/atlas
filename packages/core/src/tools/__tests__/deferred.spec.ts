import { describe, expect, it } from 'bun:test'
import { z } from 'zod'

import {
  deferredDeclarationsOf,
  deferredListingTextOf,
  mcpPartsOf,
  modelFacingDeclarationsOf,
  serverListingTextOf,
  toolNamesByServerOf,
  toolSearchTextOf,
} from '../deferred'
import { EToolEffect, type ToolDeclaration } from '../tool'

const declaration = (args: {
  name: string
  description?: string
  deferred?: true
  jsonSchema?: unknown
  inputSchema?: z.ZodType
}): ToolDeclaration => ({
  name: args.name,
  description: args.description ?? `${args.name} does something`,
  effect: EToolEffect.Read,
  inputSchema: args.inputSchema ?? z.object({ query: z.string() }),
  ...(args.deferred === true ? { deferred: true as const } : {}),
  ...(args.jsonSchema === undefined ? {} : { jsonSchema: args.jsonSchema }),
})

const exec = declaration({
  name: 'mcp__posthog__exec',
  description: 'run any PostHog command',
  deferred: true,
  jsonSchema: { type: 'object', properties: { command: { type: 'string' } } },
})

const meetings = declaration({
  name: 'mcp__wispr-flow__search_meetings',
  description: 'Search meetings and transcripts',
  deferred: true,
})

const readFile = declaration({ name: 'read', description: 'Read a file' })

const routine = declaration({ name: 'routine', description: 'Manage routines', deferred: true })

const declarations = [readFile, exec, meetings, routine]

describe('the deferred filter', () => {
  it('drops deferred declarations from the model-facing list and keeps the order of the rest', () => {
    expect(modelFacingDeclarationsOf(declarations).map((entry) => entry.name)).toEqual(['read'])
  })

  it('picks out exactly the deferred ones', () => {
    expect(deferredDeclarationsOf(declarations).map((entry) => entry.name)).toEqual([
      'mcp__posthog__exec',
      'mcp__wispr-flow__search_meetings',
      'routine',
    ])
  })
})

describe('MCP tool names', () => {
  it('splits a bridge name into its server and tool', () => {
    expect(mcpPartsOf('mcp__wispr-flow__search_meetings')).toEqual({
      server: 'wispr-flow',
      tool: 'search_meetings',
    })
  })

  it('leaves names that are not bridge names alone', () => {
    expect(mcpPartsOf('read')).toBeUndefined()
    expect(mcpPartsOf('mcp__noseparator')).toBeUndefined()
  })

  it('groups deferred names by MCP server, and every other deferred tool under atlas', () => {
    expect([...toolNamesByServerOf(declarations)]).toEqual([
      ['posthog', ['mcp__posthog__exec']],
      ['wispr-flow', ['mcp__wispr-flow__search_meetings']],
      ['atlas', ['routine']],
    ])
    expect(deferredListingTextOf(declarations)).toBe(
      'atlas: routine\nposthog: mcp__posthog__exec\nwispr-flow: mcp__wispr-flow__search_meetings',
    )
  })
})

describe('the deferred listing text', () => {
  it('renders the same text whatever order the servers and tools arrive in', () => {
    const forward = new Map([
      ['wispr-flow', ['mcp__wispr-flow__b', 'mcp__wispr-flow__a']],
      ['posthog', ['mcp__posthog__exec']],
    ])
    const backward = new Map([
      ['posthog', ['mcp__posthog__exec']],
      ['wispr-flow', ['mcp__wispr-flow__a', 'mcp__wispr-flow__b']],
    ])

    expect(serverListingTextOf(forward)).toBe(serverListingTextOf(backward))
    expect(serverListingTextOf(forward)).toBe(
      'posthog: mcp__posthog__exec\nwispr-flow: mcp__wispr-flow__a, mcp__wispr-flow__b',
    )
  })
})

describe('tool_search text', () => {
  it('matches a word from the description and renders the name, the description and the json schema', () => {
    const text = toolSearchTextOf({ declarations, query: 'posthog' })

    expect(text).toContain('1 deferred tool matched:')
    expect(text).toContain('mcp__posthog__exec')
    expect(text).toContain('run any PostHog command')
    expect(text).toContain('"command"')
    expect(text).not.toContain('mcp__wispr-flow__search_meetings')
  })

  it('derives the schema when the declaration carries no json schema', () => {
    const text = toolSearchTextOf({ declarations, query: 'transcripts' })

    expect(text).toContain('mcp__wispr-flow__search_meetings')
    expect(text).toContain('"query"')
  })

  it('lists every deferred name by server for an empty query', () => {
    expect(toolSearchTextOf({ declarations, query: '' })).toBe(deferredListingTextOf(declarations))
  })

  it('says nothing matched and still lists every deferred name', () => {
    const text = toolSearchTextOf({ declarations, query: 'kubernetes' })

    expect(text.startsWith('No deferred tool matched "kubernetes".')).toBe(true)
    expect(text).toContain('posthog: mcp__posthog__exec')
    expect(text).toContain('wispr-flow: mcp__wispr-flow__search_meetings')
  })

  it('shows at most five matches', () => {
    const many = Array.from({ length: 7 }, (_unused, index) =>
      declaration({ name: `mcp__docs__tool_${index}`, description: 'documents', deferred: true }),
    )

    const text = toolSearchTextOf({ declarations: many, query: 'documents' })

    expect(text).toContain('7 deferred tools matched; the first 5:')
    expect(text).toContain('mcp__docs__tool_4')
    expect(text).not.toContain('mcp__docs__tool_5')
  })

  it('says so when nothing is deferred', () => {
    expect(toolSearchTextOf({ declarations: [readFile], query: '' })).toBe(
      'no deferred tools are in this session.',
    )
  })
})

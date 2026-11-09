import { EDefinitionOrigin } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { EMcpRejection, mergeMcpSources, parseMcpRows, parseMcpText } from '..'
import type { McpSourceInput } from '..'

const USER = EDefinitionOrigin.User

const PROJECT = EDefinitionOrigin.Project

const stdio = { kind: 'stdio' as const, command: 'bun', args: ['run', 'server'] }

const parse = (text: string, origin = USER) => parseMcpText({ text, definedIn: 'file', origin })

const source = (args: {
  entries: readonly { name: string; disabled?: boolean }[]
  origin?: EDefinitionOrigin
  compat?: boolean
}): McpSourceInput => ({
  entries: args.entries.map((entry) => ({
    name: entry.name,
    transport: stdio,
    ...(entry.disabled === true ? { disabled: true, transport: undefined } : {}),
    origin: args.origin ?? PROJECT,
    definedIn: 'file',
  })),
  rejections: [],
  ...(args.compat === true ? { compat: true } : {}),
})

describe('entry schema', () => {
  it('parses a bare object and an mcpServers envelope', () => {
    const bare = parse(JSON.stringify({ docs: { transport: stdio } }))
    const wrapped = parse(JSON.stringify({ mcpServers: { docs: { transport: stdio } } }))
    expect(bare.entries.map((entry) => entry.name)).toEqual(['docs'])
    expect(wrapped.entries).toHaveLength(1)
  })

  it('keeps the good entries beside a bad one', () => {
    const read = parse(
      JSON.stringify({
        good: { transport: stdio },
        broken: { transport: { kind: 'stdio' } },
      }),
    )
    expect(read.entries.map((entry) => entry.name)).toEqual(['good'])
    expect(read.rejections).toHaveLength(1)
    expect(read.rejections[0]?.rejection).toBe(EMcpRejection.BadEntry)
    expect(read.rejections[0]?.name).toBe('broken')
  })

  it('accepts a disabled stub with no transport and refuses an enabled entry without one', () => {
    const read = parse(JSON.stringify({ off: { disabled: true }, on: {} }))
    expect(read.entries.map((entry) => entry.name)).toEqual(['off'])
    expect(read.rejections[0]?.rejection).toBe(EMcpRejection.BadEntry)
  })

  it('refuses a name the model cannot read in a tool name', () => {
    const read = parse(JSON.stringify({ 'bad name': { transport: stdio } }))
    expect(read.entries).toHaveLength(0)
    expect(read.rejections[0]?.rejection).toBe(EMcpRejection.BadName)
  })

  it('refuses a file that is not JSON, and one whose shape is wrong', () => {
    expect(parse('{').rejections[0]?.rejection).toBe(EMcpRejection.NotJson)
    expect(parse('[]').rejections[0]?.rejection).toBe(EMcpRejection.BadShape)
  })

  it('translates Claude flat entries, inferring the kind from command or url', () => {
    const read = parseMcText(
      JSON.stringify({
        run: { command: 'bun', args: ['x'] },
        remote: { type: 'http', url: 'https://example.com/mcp', headers: { a: 'b' } },
      }),
      true,
    )
    expect(read.entries[0]?.transport).toEqual({ kind: 'stdio', command: 'bun', args: ['x'] })
    expect(read.entries[1]?.transport).toEqual({
      kind: 'http',
      url: 'https://example.com/mcp',
      headers: { a: 'b' },
    })
  })

  it('reads cloud rows, keeping a valid row beside a broken one', () => {
    const read = parseMcpRows({
      rows: [
        { source: 'user', spec: { name: 'docs', transport: stdio } },
        { source: 'project', spec: { name: 'broken' } },
      ],
      definedIn: 'the cloud',
    })
    expect(read.entries.map((entry) => entry.name)).toEqual(['docs'])
    expect(read.entries[0]?.origin).toBe(EDefinitionOrigin.User)
    expect(read.rejections).toHaveLength(1)
  })
})

const parseMcText = (text: string, compat: boolean) =>
  parseMcpText({ text, definedIn: '.mcp.json', origin: PROJECT, ...(compat ? { compat } : {}) })

describe('precedence', () => {
  it('ranks a later source over an earlier one of the same name', () => {
    const merged = mergeMcpSources({
      sources: [
        source({ entries: [{ name: 'docs' }], origin: USER }),
        source({ entries: [{ name: 'docs' }], origin: PROJECT }),
      ],
    })
    expect(merged.servers).toHaveLength(1)
    expect(merged.servers[0]?.origin).toBe(PROJECT)
    expect(merged.shadowed).toHaveLength(1)
  })

  it('lets a repo file beat a cloud project row', () => {
    const merged = mergeMcpSources({
      sources: [
        source({ entries: [{ name: 'docs' }], origin: PROJECT }),
        source({ entries: [{ name: 'docs' }], origin: PROJECT }),
      ],
    })
    expect(merged.servers[0]?.definedIn).toBe('file')
  })

  it('lets a native definition beat a compat one regardless of order', () => {
    const merged = mergeMcpSources({
      sources: [
        source({ entries: [{ name: 'docs' }], compat: true }),
        source({ entries: [{ name: 'docs' }] }),
      ],
    })
    expect(merged.servers).toHaveLength(1)
    expect(merged.shadowed[0]?.definedIn).toBe('file')
    expect(merged.servers[0]?.disabled).toBeUndefined()
  })

  it('hides the name a disabled stub repeats', () => {
    const merged = mergeMcpSources({
      sources: [
        source({ entries: [{ name: 'docs' }], origin: USER }),
        source({ entries: [{ name: 'docs', disabled: true }], origin: PROJECT }),
      ],
    })
    expect(merged.servers).toEqual([])
  })

  it('sorts the merged list by name', () => {
    const merged = mergeMcpSources({
      sources: [source({ entries: [{ name: 'zeta' }, { name: 'alpha' }] })],
    })
    expect(merged.servers.map((entry) => entry.name)).toEqual(['alpha', 'zeta'])
  })
})

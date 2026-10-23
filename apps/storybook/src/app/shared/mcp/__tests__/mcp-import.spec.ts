import { describe, expect, test } from 'bun:test'

import { EMcpAuth, EMcpTransport } from '../../../../fixtures/settings-mcp'
import {
  EMcpImportKind,
  EMcpImportStatus,
  parseMcpImport,
  readyDrafts,
  type McpImportEntry,
} from '../mcp-import'

function servers(text: string): McpImportEntry[] {
  const result = parseMcpImport({ text })
  if (result.kind !== EMcpImportKind.Servers)
    throw new Error(`expected servers, got ${result.kind}`)
  return result.entries
}

function ready(entry: McpImportEntry | undefined) {
  if (entry?.status !== EMcpImportStatus.Ready) throw new Error('expected a ready entry')
  return entry
}

describe('wrappers', () => {
  const body = { a: { command: 'npx', args: ['-y', 'x'] }, b: { url: 'https://x.dev/mcp' } }

  test.each([
    ['mcpServers', JSON.stringify({ mcpServers: body })],
    ['servers', JSON.stringify({ servers: body })],
    ['bare map', JSON.stringify(body)],
  ])('%s yields every entry', (_label, text) => {
    const entries = servers(text)
    expect(entries.map((entry) => entry.name)).toEqual(['a', 'b'])
    expect(readyDrafts(entries)).toHaveLength(2)
  })

  test('single server object asks for a name', () => {
    const result = parseMcpImport({ text: '{"command":"npx","args":["x"]}' })
    expect(result.kind).toBe(EMcpImportKind.NeedsName)
  })

  test('single server object imports once named', () => {
    const result = parseMcpImport({ text: '{"url":"https://x.dev/mcp"}', name: 'x' })
    expect(result.kind).toBe(EMcpImportKind.Servers)
    if (result.kind === EMcpImportKind.Servers) expect(result.entries[0]?.name).toBe('x')
  })

  test('single server object can carry its own name', () => {
    const entries = servers('{"name":"solo","command":"npx"}')
    expect(entries[0]?.name).toBe('solo')
  })

  test('a server literally named like a wrapper key is still a bare map', () => {
    const entries = servers(JSON.stringify({ servers: { command: 'npx' } }))
    expect(entries[0]?.name).toBe('servers')
  })
})

describe('field mapping', () => {
  test('maps command, args and env', () => {
    const entry = ready(
      servers('{"p":{"type":"stdio","command":"npx","args":["-y","pkg"],"env":{"A":"1"}}}')[0],
    )
    expect(entry.draft.spec).toEqual({
      transport: EMcpTransport.Stdio,
      command: 'npx',
      args: ['-y', 'pkg'],
      env: [{ key: 'A', value: '1', secret: false }],
    })
  })

  test('infers the transport from command or url when type is absent', () => {
    const [local, remote] = servers('{"a":{"command":"x"},"b":{"url":"https://x.dev"}}')
    expect(ready(local).draft.spec.transport).toBe(EMcpTransport.Stdio)
    expect(ready(remote).draft.spec.transport).toBe(EMcpTransport.Http)
  })

  test('remote entry without headers defaults to oauth', () => {
    const entry = ready(servers('{"a":{"type":"http","url":"https://x.dev/mcp"}}')[0])
    expect(entry.draft.spec).toMatchObject({ auth: { kind: EMcpAuth.OAuth }, headers: [] })
  })

  test('a bearer authorization header becomes the bearer token', () => {
    const entry = ready(
      servers('{"a":{"url":"https://x.dev","headers":{"Authorization":"Bearer ${GH_TOKEN}"}}}')[0],
    )
    expect(entry.draft.spec).toMatchObject({
      auth: { kind: EMcpAuth.Bearer, token: '${GH_TOKEN}' },
      headers: [],
    })
  })

  test('other headers keep auth at none and flag secret-looking ones', () => {
    const entry = ready(
      servers('{"a":{"url":"https://x.dev","headers":{"X-Api-Key":"abc","X-Team":"core"}}}')[0],
    )
    expect(entry.draft.spec).toMatchObject({
      auth: { kind: EMcpAuth.None },
      headers: [
        { key: 'X-Api-Key', value: 'abc', secret: true },
        { key: 'X-Team', value: 'core', secret: false },
      ],
    })
  })

  test('disabled: true imports as disabled', () => {
    const entry = ready(servers('{"a":{"command":"x","disabled":true}}')[0])
    expect(entry.draft.enabled).toBe(false)
  })

  test('numeric and boolean env values are stringified', () => {
    const entry = ready(servers('{"a":{"command":"x","env":{"N":1,"B":true}}}')[0])
    expect(entry.draft.spec).toMatchObject({
      env: [
        { key: 'N', value: '1' },
        { key: 'B', value: 'true' },
      ],
    })
  })
})

describe('native shape', () => {
  test('imports transport.kind stdio', () => {
    const text = '{"a":{"transport":{"kind":"stdio","command":"bun","args":["run"]}}}'
    expect(ready(servers(text)[0]).draft.spec).toMatchObject({
      transport: EMcpTransport.Stdio,
      command: 'bun',
      args: ['run'],
    })
  })

  test('imports transport.kind http with headers', () => {
    const text =
      '{"a":{"transport":{"kind":"http","url":"https://x.dev","headers":{"X-Team":"core"}}}}'
    expect(ready(servers(text)[0]).draft.spec).toMatchObject({
      transport: EMcpTransport.Http,
      url: 'https://x.dev',
      headers: [{ key: 'X-Team', value: 'core', secret: false }],
    })
  })

  test('imports a single native entry', () => {
    const result = parseMcpImport({
      text: '{"transport":{"kind":"http","url":"https://x.dev"}}',
    })
    expect(result.kind).toBe(EMcpImportKind.NeedsName)
  })
})

describe('sse and secret refs', () => {
  test('sse imports as remote with a note', () => {
    const entry = ready(servers('{"a":{"type":"sse","url":"https://x.dev/sse"}}')[0])
    expect(entry.draft.spec.transport).toBe(EMcpTransport.Http)
    expect(entry.notes).toContain('Imported as Streamable HTTP.')
  })

  test('${VAR} and ${env:VAR} both become ${VAR} refs', () => {
    const entry = ready(
      servers(
        '{"a":{"command":"x","env":{"A":"${ONE}","B":"${env:TWO}"},"args":["${env:THREE}"]}}',
      )[0],
    )
    expect(entry.draft.spec).toMatchObject({
      args: ['${THREE}'],
      env: [
        { key: 'A', value: '${ONE}' },
        { key: 'B', value: '${TWO}' },
      ],
    })
    expect(entry.notes).toContain('Uses secrets: THREE, ONE, TWO.')
  })
})

describe('rejects', () => {
  function errorOf(text: string): string {
    const entry = servers(text)[0]
    if (entry?.status !== EMcpImportStatus.Error) throw new Error('expected an error entry')
    return entry.error
  }

  test('ws type', () => {
    expect(errorOf('{"a":{"type":"ws","url":"ws://x.dev"}}')).toContain('WebSocket')
  })

  test('ws url', () => {
    expect(errorOf('{"a":{"url":"wss://x.dev"}}')).toContain('WebSocket')
  })

  test('unknown type', () => {
    expect(errorOf('{"a":{"type":"carrier-pigeon","url":"https://x.dev"}}')).toContain(
      'carrier-pigeon',
    )
  })

  test('missing command', () => {
    expect(errorOf('{"a":{"type":"stdio"}}')).toBe('Missing command.')
    expect(errorOf('{"a":{"type":"stdio","command":"  "}}')).toBe('Missing command.')
  })

  test('missing url', () => {
    expect(errorOf('{"a":{"type":"http"}}')).toBe('Missing url.')
  })

  test('neither command nor url', () => {
    expect(errorOf('{"a":{"headers":{}}}')).toBe('Needs a command or a url.')
  })

  test('invalid url', () => {
    expect(errorOf('{"a":{"url":"not a url"}}')).toBe('Invalid url.')
  })

  test('vs code input refs', () => {
    expect(errorOf('{"a":{"command":"x","env":{"K":"${input:key}"}}}')).toContain('${NAME}')
  })

  test('invalid server name', () => {
    expect(errorOf('{"bad name":{"command":"x"}}')).toContain('letters')
  })

  test('entry that is not an object', () => {
    const entries = servers('{"a":{"command":"x"},"b":"nope"}')
    expect(entries[1]?.status).toBe(EMcpImportStatus.Error)
  })

  test('one bad entry does not sink the others', () => {
    const entries = servers('{"a":{"command":"x"},"b":{"type":"ws","url":"ws://x"}}')
    expect(readyDrafts(entries).map((draft) => draft.name)).toEqual(['a'])
  })
})

describe('invalid input', () => {
  test('empty', () => {
    expect(parseMcpImport({ text: '  ' }).kind).toBe(EMcpImportKind.Empty)
  })

  test('invalid json', () => {
    expect(parseMcpImport({ text: '{"a":' })).toEqual({
      kind: EMcpImportKind.Invalid,
      message: 'Not valid JSON.',
    })
  })

  test.each(['[]', '"x"', '42', 'null'])('%s is not an object', (text) => {
    expect(parseMcpImport({ text }).kind).toBe(EMcpImportKind.Invalid)
  })

  test('empty server map', () => {
    expect(parseMcpImport({ text: '{"mcpServers":{}}' }).kind).toBe(EMcpImportKind.Invalid)
    expect(parseMcpImport({ text: '{}' }).kind).toBe(EMcpImportKind.Invalid)
  })
})

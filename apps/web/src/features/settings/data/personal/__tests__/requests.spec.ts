import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { EMemoryScope, EMemoryType } from '@dltech/atlas-wire/web'

import { ESecretKind } from '../../../fixtures/settings-library'
import { EMcpTransport } from '../../../fixtures/settings-mcp'
import { addMcpServer } from '../mcp-api'
import { fetchMemoryGroups } from '../memory-api'
import { saveSecretEntry } from '../secrets-api'

type Call = { url: string; method: string; body: unknown }

let calls: Call[]
let answer: () => Response
const realFetch = globalThis.fetch

beforeEach(() => {
  calls = []
  answer = () => new Response(null, { status: 204 })
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const raw = init?.body
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      body: typeof raw === 'string' ? JSON.parse(raw) : undefined,
    })
    return answer()
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
})

const stored = {
  id: 'API_KEY',
  key: 'API_KEY',
  kind: ESecretKind.Secret,
  value: 'hunter2',
  updated: 'now',
  addedBy: { name: 'Me', initials: 'M' },
}

describe('personal secret save', () => {
  it('keeps the stored value when an edit leaves the value blank', async () => {
    await saveSecretEntry({
      entry: { key: 'API_KEY', value: '', kind: ESecretKind.Secret },
      secrets: [stored],
    })
    expect(calls).toEqual([
      {
        url: '/v1/secrets/API_KEY',
        method: 'PUT',
        body: { value: 'hunter2', kind: ESecretKind.Secret },
      },
    ])
  })

  it('keeps the stored value on a kind-only change', async () => {
    await saveSecretEntry({
      entry: { key: 'API_KEY', value: '', kind: ESecretKind.EnvVar },
      secrets: [stored],
    })
    expect(calls[0]?.body).toEqual({ value: 'hunter2', kind: ESecretKind.EnvVar })
  })

  it('sends a typed value and refuses a blank new secret', async () => {
    await saveSecretEntry({
      entry: { key: 'API_KEY', value: 'new', kind: ESecretKind.Secret },
      secrets: [stored],
    })
    expect(calls[0]?.body).toEqual({ value: 'new', kind: ESecretKind.Secret })
    expect(() =>
      saveSecretEntry({
        entry: { key: 'OTHER', value: '', kind: ESecretKind.Secret },
        secrets: [stored],
      }),
    ).toThrow('A value is required')
    expect(calls).toHaveLength(1)
  })
})

describe('personal MCP add', () => {
  it('sends stdio env', async () => {
    await addMcpServer({
      id: 'fs',
      transport: EMcpTransport.Stdio,
      target: 'npx -y pkg',
      extra: 'API_KEY=abc\n# note\nREGION=eu',
    })
    expect(calls).toEqual([
      {
        url: '/v1/mcp-servers/fs',
        method: 'PUT',
        body: {
          transport: {
            kind: 'stdio',
            command: 'npx',
            args: ['-y', 'pkg'],
            env: { API_KEY: 'abc', REGION: 'eu' },
          },
          disabled: false,
        },
      },
    ])
  })

  it('sends http headers', async () => {
    await addMcpServer({
      id: 'remote',
      transport: EMcpTransport.Http,
      target: 'https://x.dev/mcp',
      extra: 'Authorization: Bearer t',
    })
    expect(calls[0]?.body).toEqual({
      transport: { kind: 'http', url: 'https://x.dev/mcp', headers: { Authorization: 'Bearer t' } },
      disabled: false,
    })
  })

  it('omits env and headers when the field is blank', async () => {
    await addMcpServer({ id: 'bare', transport: EMcpTransport.Stdio, target: 'bun x', extra: '' })
    expect(calls[0]?.body).toEqual({
      transport: { kind: 'stdio', command: 'bun', args: ['x'] },
      disabled: false,
    })
  })
})

describe('memory groups', () => {
  it('reads /v1/memories/all only and groups by the rows', async () => {
    const row = (project: string | null, name: string) => ({
      scope: project === null ? EMemoryScope.Global : EMemoryScope.Project,
      project,
      name,
      description: 'd',
      type: EMemoryType.User,
      revision: 1,
      updatedAt: 'x',
    })
    answer = () =>
      new Response(JSON.stringify({ memories: [row('a/b', 'one'), row(null, 'two')] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    const groups = await fetchMemoryGroups()
    expect(calls.map((call) => call.url)).toEqual(['/v1/memories/all'])
    expect(groups.map((group) => group.id)).toEqual(['global', 'a/b'])
  })
})

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { EMemoryScope, EMemoryType } from '@dltech/atlas-wire/web'

import { answerTrpc, resetTrpc, restoreTrpc, trpcCalls, trpcData } from '@/lib/__tests__/fake-trpc'
import { ESecretKind } from '../../../fixtures/settings-library'
import { EMcpTransport } from '../../../fixtures/settings-mcp'
import { addMcpServer } from '../mcp-api'
import { deleteMemory, fetchMemoryEntry, fetchMemoryGroups } from '../memory-api'
import { deleteSecret, saveSecretEntry } from '../secrets-api'

beforeEach(resetTrpc)
afterEach(restoreTrpc)

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
    expect(trpcCalls).toEqual([
      {
        url: '/v1/trpc/secrets.set',
        method: 'POST',
        body: { name: 'API_KEY', value: 'hunter2', kind: ESecretKind.Secret },
      },
    ])
  })

  it('keeps the stored value on a kind-only change', async () => {
    await saveSecretEntry({
      entry: { key: 'API_KEY', value: '', kind: ESecretKind.EnvVar },
      secrets: [stored],
    })
    expect(trpcCalls[0]?.body).toEqual({
      name: 'API_KEY',
      value: 'hunter2',
      kind: ESecretKind.EnvVar,
    })
  })

  it('sends a typed value and refuses a blank new secret', async () => {
    await saveSecretEntry({
      entry: { key: 'API_KEY', value: 'new', kind: ESecretKind.Secret },
      secrets: [stored],
    })
    expect(trpcCalls[0]?.body).toEqual({
      name: 'API_KEY',
      value: 'new',
      kind: ESecretKind.Secret,
    })
    expect(() =>
      saveSecretEntry({
        entry: { key: 'OTHER', value: '', kind: ESecretKind.Secret },
        secrets: [stored],
      }),
    ).toThrow('A value is required')
    expect(trpcCalls).toHaveLength(1)
  })

  it('deletes by name', async () => {
    await deleteSecret('API_KEY')
    expect(trpcCalls).toEqual([
      { url: '/v1/trpc/secrets.remove', method: 'POST', body: { name: 'API_KEY' } },
    ])
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
    expect(trpcCalls).toEqual([
      {
        url: '/v1/trpc/mcpServers.put',
        method: 'POST',
        body: {
          name: 'fs',
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
    expect(trpcCalls[0]?.body).toEqual({
      name: 'remote',
      transport: { kind: 'http', url: 'https://x.dev/mcp', headers: { Authorization: 'Bearer t' } },
      disabled: false,
    })
  })

  it('omits env and headers when the field is blank', async () => {
    await addMcpServer({ id: 'bare', transport: EMcpTransport.Stdio, target: 'bun x', extra: '' })
    expect(trpcCalls[0]?.body).toEqual({
      name: 'bare',
      transport: { kind: 'stdio', command: 'bun', args: ['x'] },
      disabled: false,
    })
  })
})

describe('memory groups', () => {
  it('reads memories.listAll only and groups by the rows', async () => {
    const row = (project: string | null, name: string) => ({
      scope: project === null ? EMemoryScope.Global : EMemoryScope.Project,
      project,
      name,
      description: 'd',
      type: EMemoryType.User,
      revision: 1,
      updatedAt: 'x',
    })
    answerTrpc(() => trpcData({ memories: [row('a/b', 'one'), row(null, 'two')] }))
    const groups = await fetchMemoryGroups()
    expect(trpcCalls.map((call) => call.url)).toEqual(['/v1/trpc/memories.listAll'])
    expect(trpcCalls[0]?.method).toBe('GET')
    expect(groups.map((group) => group.id)).toEqual(['global', 'a/b'])
  })
})

describe('memory entry', () => {
  it('reads an entry with the key as the url input and omits a null project', async () => {
    answerTrpc(() =>
      trpcData({
        scope: 'global',
        project: null,
        name: 'n',
        description: 'd',
        type: EMemoryType.User,
        revision: 1,
        updatedAt: 'x',
        body: 'b',
      }),
    )
    const entry = await fetchMemoryEntry({ scope: EMemoryScope.Global, project: null, name: 'n' })
    expect(entry.body).toBe('b')
    expect(trpcCalls).toEqual([
      {
        url: `/v1/trpc/memories.get?input=${encodeURIComponent(JSON.stringify({ scope: 'global', name: 'n' }))}`,
        method: 'GET',
        body: undefined,
      },
    ])
  })

  it('deletes with the project when one is set', async () => {
    await deleteMemory({ scope: EMemoryScope.Project, project: 'a/b', name: 'n' })
    expect(trpcCalls).toEqual([
      {
        url: '/v1/trpc/memories.remove',
        method: 'POST',
        body: { scope: 'project', name: 'n', project: 'a/b' },
      },
    ])
  })
})

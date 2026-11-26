import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { EMemoryScope, EMemoryType } from '@dltech/atlas-wire/web'

import { answerTrpc, resetTrpc, restoreTrpc, trpcCalls, trpcData } from '@/lib/__tests__/fake-trpc'
import { memoryGroupLabel } from '../../../fixtures/settings-memory'
import { EMcpTransport } from '../../../fixtures/settings-mcp'
import { addMcpServer } from '../mcp-api'
import { deleteMemory, fetchMemoryEntry, fetchMemoryGroups } from '../memory-api'
import { putHarnessSecret } from '../harness-secrets-api'

beforeEach(resetTrpc)
afterEach(restoreTrpc)

describe('harness secret save', () => {
  it('sends agent keys to harnessSecrets.set', async () => {
    await putHarnessSecret({ name: 'search.tavily', value: 'k' })
    expect(trpcCalls).toEqual([
      {
        url: '/v1/trpc/harnessSecrets.set',
        method: 'POST',
        body: { name: 'search.tavily', value: 'k' },
      },
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

type MemoryRow = {
  scope: EMemoryScope
  project: string | null
  groupId: string | null
  name: string
  description: string
  type: EMemoryType
  revision: number
  updatedAt: string
}

const rowOf = (args: {
  scope: EMemoryScope
  project: string | null
  groupId?: string | null
  name: string
}): MemoryRow => ({
  scope: args.scope,
  project: args.project,
  groupId: args.groupId ?? null,
  name: args.name,
  description: 'd',
  type: EMemoryType.User,
  revision: 1,
  updatedAt: 'x',
})

const answerMemoryGroups = (memories: MemoryRow[]): void =>
  answerTrpc(() =>
    trpcCalls[trpcCalls.length - 1]?.url === '/v1/trpc/projectGroups.list'
      ? trpcData({ groups: [{ id: 'pgr_comp', name: 'Comp AI' }] })
      : trpcData({ memories }),
  )

describe('memory groups', () => {
  it('reads the memories and the group names, and buckets global, group and project', async () => {
    answerMemoryGroups([
      rowOf({ scope: EMemoryScope.Project, project: 'a/b', name: 'one' }),
      rowOf({ scope: EMemoryScope.Group, project: null, groupId: 'pgr_comp', name: 'two' }),
      rowOf({ scope: EMemoryScope.Global, project: null, name: 'three' }),
    ])

    const groups = await fetchMemoryGroups()

    expect(trpcCalls.map((call) => call.url).sort()).toEqual([
      '/v1/trpc/memories.listAll',
      '/v1/trpc/projectGroups.list',
    ])
    expect(groups.map((group) => group.id)).toEqual(['global', 'group:pgr_comp', 'a/b'])
    expect(groups.map(memoryGroupLabel)).toEqual(['Global', 'Comp AI', 'a/b'])
  })
})

describe('memory entry', () => {
  it('reads an entry with the key as the url input and omits a null project', async () => {
    answerTrpc(() =>
      trpcData({
        scope: 'global',
        project: null,
        groupId: null,
        name: 'n',
        description: 'd',
        type: EMemoryType.User,
        revision: 1,
        updatedAt: 'x',
        body: 'b',
      }),
    )
    const entry = await fetchMemoryEntry({
      scope: EMemoryScope.Global,
      project: null,
      groupId: null,
      name: 'n',
    })
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
    await deleteMemory({ scope: EMemoryScope.Project, project: 'a/b', groupId: null, name: 'n' })
    expect(trpcCalls).toEqual([
      {
        url: '/v1/trpc/memories.remove',
        method: 'POST',
        body: { scope: 'project', name: 'n', project: 'a/b' },
      },
    ])
  })
})

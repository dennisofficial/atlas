import { describe, expect, it } from 'bun:test'

import { EDefinitionOrigin } from '@dltech/atlas-core'

import { RemoteMcpSource } from '../remote-mcp-source'
import { EMcpRejection } from '../sources'

const URL = 'http://cloud.test'

const session = { url: URL, token: 'sess_test', email: null }

const sourceOver = (respond: () => { status: number; body?: unknown }): RemoteMcpSource => {
  const fetchFn = (async (_input: unknown, _init?: RequestInit) => {
    const answer = respond()
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
      status: answer.status,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch

  return new RemoteMcpSource({ session, fetchFn })
}

describe('RemoteMcpSource', () => {
  it('maps remote servers to user-origin specs defined at the collection url', async () => {
    const source = sourceOver(() => ({
      status: 200,
      body: {
        servers: [
          {
            name: 'linear',
            transport: { kind: 'http', url: 'https://mcp.linear.app/mcp' },
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
          { name: 'paused', disabled: true, updatedAt: '2026-01-02T00:00:00.000Z' },
        ],
      },
    }))

    const read = await source.load()

    expect(source.origin).toBe(EDefinitionOrigin.User)
    expect(read.rejections).toHaveLength(0)
    expect(read.specs).toEqual([
      {
        name: 'linear',
        transport: { kind: 'http', url: 'https://mcp.linear.app/mcp' },
        origin: EDefinitionOrigin.User,
        definedIn: 'http://cloud.test/v1/mcp-servers',
      },
      {
        name: 'paused',
        disabled: true,
        origin: EDefinitionOrigin.User,
        definedIn: 'http://cloud.test/v1/mcp-servers',
      },
    ])
  })

  it('answers an Unreadable rejection instead of throwing when the fetch fails', async () => {
    const source = sourceOver(() => ({ status: 500, body: { message: 'boom' } }))

    const read = await source.load()

    expect(read.specs).toHaveLength(0)
    expect(read.rejections).toHaveLength(1)
    expect(read.rejections[0]).toMatchObject({
      rejection: EMcpRejection.Unreadable,
      name: undefined,
      definedIn: 'http://cloud.test/v1/mcp-servers',
      origin: EDefinitionOrigin.User,
    })
  })

  it('answers a BadEntry rejection when a server-side entry fails the spec schema', async () => {
    const source = sourceOver(() => ({
      status: 200,
      body: { servers: [{ name: 'broken', updatedAt: '2026-01-01T00:00:00.000Z' }] },
    }))

    const read = await source.load()

    expect(read.specs).toHaveLength(0)
    expect(read.rejections[0]?.rejection).toBe(EMcpRejection.BadEntry)
  })

  it('sends the wired client version on its requests', async () => {
    const seen: { version: string | null } = { version: null }
    const fetchFn = (async (_input: unknown, init?: RequestInit) => {
      seen.version = new Headers(init?.headers).get('atlas-client-version')
      return new Response(JSON.stringify({ servers: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch

    const source = new RemoteMcpSource({ session, clientVersion: '4.5.6', fetchFn })
    await source.load()

    expect(seen.version).toBe('4.5.6')
  })
})

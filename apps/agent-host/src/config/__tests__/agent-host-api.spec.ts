import { describe, expect, it } from 'bun:test'

import type { AgentHostConfigOutput } from '@dltech/atlas-protocol'

import { createAgentHostApi } from '../agent-host-api'

const configBody = (expiresAt: string): AgentHostConfigOutput => ({
  userId: 'u1',
  projectId: 'p1',
  model: { configured: false, gap: 'none' },
  vercel: { configured: false, gap: 'none' },
  config: {
    settings: {},
    secrets: [],
    harnessSecrets: [],
    mcpServers: [],
    fileMounts: [],
    provenance: {},
  },
  revision: 'r1',
  expiresAt,
})

const trpcFetch = (
  handler: (url: string) => { ok: boolean; body: unknown },
): { fetchFn: typeof fetch; calls: string[] } => {
  const calls: string[] = []
  const fetchFn = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    calls.push(url)
    const { ok, body } = handler(url)
    if (!ok) {
      return new Response(
        JSON.stringify({
          error: {
            message: 'boom',
            code: -32603,
            data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 },
          },
        }),
        { status: 500, headers: { 'content-type': 'application/json' } },
      )
    }
    return new Response(JSON.stringify({ result: { data: body } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
  return { fetchFn, calls }
}

describe('createAgentHostApi', () => {
  it('caches config per session until expiresAt', async () => {
    const { fetchFn, calls } = trpcFetch(() => ({
      ok: true,
      body: configBody('2026-11-03T12:05:00.000Z'),
    }))
    let now = Date.parse('2026-11-03T12:00:00.000Z')
    const api = createAgentHostApi({
      apiOrigin: 'https://api.test',
      agentHostToken: 't'.repeat(32),
      fetchFn,
      now: () => now,
    })
    await api.config({ sessionId: 's1' })
    await api.config({ sessionId: 's1' })
    await api.config({ sessionId: 's2' })
    expect(calls.length).toBe(2)
    expect(calls.every((url) => url.startsWith('https://api.test/v1/trpc/agentHost.config'))).toBe(
      true,
    )

    now = Date.parse('2026-11-03T12:06:00.000Z')
    await api.config({ sessionId: 's1' })
    expect(calls.length).toBe(3)
  })

  it('keeps serving the cached config when the refresh fails after expiry', async () => {
    let fail = false
    const { fetchFn } = trpcFetch(() =>
      fail ? { ok: false, body: {} } : { ok: true, body: configBody('2026-11-03T12:05:00.000Z') },
    )
    let now = Date.parse('2026-11-03T12:00:00.000Z')
    const api = createAgentHostApi({
      apiOrigin: 'https://api.test',
      agentHostToken: 't'.repeat(32),
      fetchFn,
      now: () => now,
    })
    const first = await api.config({ sessionId: 's1' })
    now = Date.parse('2026-11-03T12:06:00.000Z')
    fail = true
    const second = await api.config({ sessionId: 's1' })
    expect(second).toEqual(first)
  })

  it('propagates the failure with no cached value', async () => {
    const { fetchFn } = trpcFetch(() => ({ ok: false, body: {} }))
    const api = createAgentHostApi({
      apiOrigin: 'https://api.test',
      agentHostToken: 't'.repeat(32),
      fetchFn,
    })
    await expect(api.config({ sessionId: 's1' })).rejects.toThrow()
  })
})

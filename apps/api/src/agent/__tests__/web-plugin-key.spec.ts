import { describe, expect, it, spyOn } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'

import { readAgentHostEnv } from '../config/env'
import { composedPluginsOf } from '../registered-plugins'
import { podContextOf } from '../testing/pod-context'

const hostEnv: Record<string, string> = {
  DATABASE_URL: 'postgres://x',
  DATABASE_DIRECT_URL: 'postgres://direct',
  REDIS_URL: 'redis://x',
  DAEMON_SECRET: 'secret',
  SECRETS_ENCRYPTION_KEY: 'k'.repeat(64),
  ATLAS_API_ORIGIN: 'https://api.byatlas.io',
  CLOUDFLARE_API_TOKEN: 'cf-token',
  CLOUDFLARE_ACCOUNT_ID: 'cf-account',
  CLOUDFLARE_ZONE_ID: 'cf-zone',
}

const searchWith = async (env: Record<string, string>): Promise<unknown> => {
  const tools = composedPluginsOf(readAgentHostEnv(env)).pod.tools(podContextOf('s-1'))
  const tool = tools.find((candidate) => candidate.name === 'web_search')
  if (tool === undefined) throw new Error('web_search is not registered')
  return await tool.invoke({
    input: { query: 'atlas' },
    signal: new AbortController().signal,
    idempotencyKey: 'key-1',
    projectDirectory: '/work/repo',
    activeWorktree: undefined,
    threadId: toThreadId('thr_1'),
  })
}

describe('the web plugin key', () => {
  it('searches Jina with the host key as the bearer', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ data: [{ title: 'Atlas', url: 'https://example.com', description: 'x' }] }),
    )
    try {
      await searchWith({ ...hostEnv, JINA_API_KEY: 'host-jina-key' })
      const init = fetchSpy.mock.calls[0]?.[1]
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer host-jina-key')
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('answers that the host holds no key when none is set', async () => {
    const outcome = await searchWith(hostEnv)
    expect(outcome).toMatchObject({ ok: false })
    expect(JSON.stringify(outcome)).toContain('no Jina key on this host')
  })
})

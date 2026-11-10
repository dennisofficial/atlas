import { afterEach, describe, expect, it } from 'bun:test'

import { beginMcpSignIn } from '../mcp-signin-request'

type Call = { url: string; method: string; authorization: string | null; body: unknown }

let restore: (() => void) | undefined

const stubFetch = (answer: Response): { calls: Call[] } => {
  const calls: Call[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      authorization: new Headers(init?.headers).get('authorization'),
      body,
    })
    return answer
  }) as typeof fetch
  restore = () => {
    globalThis.fetch = original
  }
  return { calls }
}

afterEach(() => {
  restore?.()
  restore = undefined
})

const args = {
  hostOrigin: 'https://agent.example.test',
  token: 'bearer-1',
  serverId: 'srv_1',
  surface: 'web' as const,
  screen: { kind: 'settings' as const, scope: 'user' as const },
}

describe('beginMcpSignIn', () => {
  it('posts the row and its screen to the host and reads the link back', async () => {
    const { calls } = stubFetch(Response.json({ url: 'https://auth.example/authorize' }))

    const result = await beginMcpSignIn(args)

    expect(result).toEqual({ ok: true, url: 'https://auth.example/authorize' })
    expect(calls[0]?.url).toBe('https://agent.example.test/mcp-oauth/begin')
    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.authorization).toBe('Bearer bearer-1')
    expect(calls[0]?.body).toEqual({
      serverId: 'srv_1',
      surface: 'web',
      screen: { kind: 'settings', scope: 'user' },
    })
  })

  it('names a project screen', async () => {
    const { calls } = stubFetch(Response.json({ url: 'https://auth.example/authorize' }))

    await beginMcpSignIn({
      ...args,
      screen: { kind: 'settings', scope: 'project', id: 'proj_1' },
    })

    expect(calls[0]?.body).toMatchObject({
      screen: { kind: 'settings', scope: 'project', id: 'proj_1' },
    })
  })

  it('reports the reason the host refused', async () => {
    stubFetch(Response.json({ reason: 'unsupported' }, { status: 422 }))

    expect(await beginMcpSignIn(args)).toEqual({ ok: false, reason: 'unsupported' })
  })

  it('reports a refusal that carries no reason of its own', async () => {
    stubFetch(new Response('nope', { status: 502 }))

    expect(await beginMcpSignIn(args)).toEqual({
      ok: false,
      reason: 'the agent host answered 502',
    })
  })

  it('reports an answer with no link', async () => {
    stubFetch(Response.json({ url: '' }))

    expect(await beginMcpSignIn(args)).toEqual({
      ok: false,
      reason: 'the agent host sent no link',
    })
  })
})

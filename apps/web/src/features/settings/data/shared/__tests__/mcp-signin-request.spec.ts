import { beforeEach, describe, expect, it, mock } from 'bun:test'

import { createApiClient } from '@dltech/atlas-api-router'

import { trpcBodyOf } from '@/lib/__tests__/trpc-body'

type Call = { url: string; method: string; body: string }

const calls: Call[] = []
let answer: () => Response = () => Response.json({})

const recordingFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  calls.push({
    url: String(input),
    method: init?.method ?? 'GET',
    body: typeof init?.body === 'string' ? JSON.stringify(trpcBodyOf(init.body)) : '',
  })
  return answer()
}) as typeof fetch

mock.module('@/lib/api-client', () => ({
  api: createApiClient({ baseUrl: '', fetchFn: recordingFetch }),
}))

const { beginMcpSignIn } = await import('../mcp-signin-request')

const dataAnswer = (data: unknown) => () => Response.json({ result: { data } })

const args = {
  serverId: 'srv_1',
  surface: 'web' as const,
  screen: { kind: 'settings' as const, scope: 'user' as const },
}

beforeEach(() => {
  calls.length = 0
  answer = () => Response.json({})
})

describe('beginMcpSignIn', () => {
  it('asks the api for the link and reads it back', async () => {
    const url = 'https://auth.example/authorize'
    answer = dataAnswer({ outcome: 'redirect', authorizationUrl: url })

    const result = await beginMcpSignIn(args)

    expect(result).toEqual({ ok: true, url })
    expect(calls[0]?.url).toContain('/v1/trpc/mcpOauth.begin')
    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.body).toContain('srv_1')
    expect(calls[0]?.body).toContain('"screen":{"kind":"settings","scope":"user"}')
  })

  it('names a project screen', async () => {
    answer = dataAnswer({ outcome: 'redirect', authorizationUrl: 'https://a.test' })

    await beginMcpSignIn({
      ...args,
      screen: { kind: 'settings', scope: 'project', id: 'proj_1' },
    })

    expect(calls[0]?.body).toContain('"scope":"project"')
    expect(calls[0]?.body).toContain('proj_1')
  })

  it('reports the reason the api refused', async () => {
    answer = dataAnswer({ outcome: 'unsupported', reason: 'unsupported' })

    expect(await beginMcpSignIn(args)).toEqual({ ok: false, reason: 'unsupported' })
  })

  it('reports an api it could not reach', async () => {
    answer = () => new Response('nope', { status: 502 })

    expect(await beginMcpSignIn(args)).toEqual({
      ok: false,
      reason: 'the api could not begin the sign-in',
    })
  })
})

import { describe, expect, it } from 'vitest'

import { toThreadId } from '@dltech/atlas-core'
import {
  API_PROVISIONED_ENV,
  SANDBOX_SELF_PORTS_PATH,
  SANDBOX_SELF_STOP_PATH,
} from '@dltech/atlas-wire'

import { apiPortExposer } from '../api-port-exposer'
import { sandboxPark } from '../sandbox-park'
import { ServeProcessPort } from '../serve-process'

type Call = { url: string; headers: Headers; body: unknown }

const fakeFetch = (reply: () => Response) => {
  const calls: Call[] = []
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)),
    })
    return reply()
  }) as unknown as typeof fetch
  return { calls, fetchFn }
}

const controlPlaneUrl = 'https://api.example.com'

describe('apiPortExposer', () => {
  it('posts the port with the serve token and answers the url', async () => {
    const { calls, fetchFn } = fakeFetch(() => Response.json({ url: 'https://sb-1.vercel.run' }))
    const exposer = apiPortExposer({
      controlPlaneUrl,
      token: 'serve-token',
      clientVersion: '1.2.3',
      fetchFn,
    })

    const outcome = await new ServeProcessPort(exposer).exposePort({ containerPort: 3000 })

    expect(outcome).toEqual({
      ok: true,
      exposure: { containerPort: 3000, hostPort: 3000, url: 'https://sb-1.vercel.run' },
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(`${controlPlaneUrl}${SANDBOX_SELF_PORTS_PATH}`)
    expect(calls[0]?.body).toEqual({ port: 3000 })
    expect(calls[0]?.headers.get('authorization')).toBe('Bearer serve-token')
    expect(calls[0]?.headers.get('content-type')).toBe('application/json')
    expect(calls[0]?.headers.get('atlas-client-version')).toBe('1.2.3')
  })

  it('turns a non-2xx answer into a refusal carrying the status and body', async () => {
    const { fetchFn } = fakeFetch(() => new Response('port limit reached', { status: 409 }))
    const exposer = apiPortExposer({
      controlPlaneUrl,
      token: 'serve-token',
      clientVersion: 'dev',
      fetchFn,
    })

    const outcome = await new ServeProcessPort(exposer).exposePort({ containerPort: 3000 })

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toContain('409')
    expect(outcome.reason).toContain('port limit reached')
  })
})

describe('sandboxPark when api-provisioned', () => {
  const threadId = toThreadId('thread-self-stop')

  it('posts the session id to the stop path with the serve token', async () => {
    const { calls, fetchFn } = fakeFetch(() => Response.json({}))
    const stop = sandboxPark({
      threadId,
      controlPlaneUrl,
      token: 'serve-token',
      clientVersion: '1.2.3',
      fetchFn,
      env: { [API_PROVISIONED_ENV]: '1', ATLAS_SANDBOX_SESSION_ID: 'session-9' },
    })

    expect(calls).toEqual([])
    await stop?.()

    expect(calls[0]?.url).toBe(`${controlPlaneUrl}${SANDBOX_SELF_STOP_PATH}`)
    expect(calls[0]?.body).toEqual({ sessionId: 'session-9' })
    expect(calls[0]?.headers.get('authorization')).toBe('Bearer serve-token')
    expect(calls[0]?.headers.get('atlas-client-version')).toBe('1.2.3')
  })

  it('omits an empty session id', async () => {
    const { calls, fetchFn } = fakeFetch(() => Response.json({}))
    await sandboxPark({
      threadId,
      controlPlaneUrl,
      token: 'serve-token',
      fetchFn,
      env: { [API_PROVISIONED_ENV]: '1', ATLAS_SANDBOX_SESSION_ID: '' },
    })?.()

    expect(calls[0]?.body).toEqual({})
  })

  it('rejects when the control plane refuses the stop', async () => {
    const { fetchFn } = fakeFetch(() => new Response('nope', { status: 401 }))
    const stop = sandboxPark({
      threadId,
      controlPlaneUrl,
      token: 'serve-token',
      fetchFn,
      env: { [API_PROVISIONED_ENV]: '1' },
    })

    await expect(stop?.()).rejects.toThrow('401')
  })
})

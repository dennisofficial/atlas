import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { podControlClientOf } from '../client'

const ORIGIN = 'https://api.example.test'

type Seen = { url: string; init: RequestInit | undefined }

let seen: Seen[] = []
const realFetch = globalThis.fetch

const stubFetch = (respond: () => Response): void => {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(input), init })
    return respond()
  }) as typeof fetch
}

const reply = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const client = (): ReturnType<typeof podControlClientOf> =>
  podControlClientOf({ apiOrigin: ORIGIN, token: 'host-token' })

describe('podControlClientOf', () => {
  beforeEach(() => {
    seen = []
  })

  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('posts the thread and port with the host bearer and returns the reply', async () => {
    stubFetch(() =>
      reply({ result: { data: { url: 'https://4317-abc.byatlas.dev', tunnelToken: 'tunnel' } } }),
    )
    const exposed = await client().exposePort({ threadId: 'thr_1', port: 4317 })
    expect(exposed).toEqual({ url: 'https://4317-abc.byatlas.dev', tunnelToken: 'tunnel' })
    expect(seen).toHaveLength(1)
    expect(seen[0]?.url).toBe(`${ORIGIN}/v1/trpc/hostSelf.exposePort`)
    const headers = seen[0]?.init?.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer host-token')
    expect(headers['content-type']).toBe('application/json')
    expect(seen[0]?.init?.body).toBe(JSON.stringify({ threadId: 'thr_1', port: 4317 }))
  })

  it('throws the message of an error envelope', async () => {
    stubFetch(() => reply({ error: { json: { message: 'thread not found' } } }))
    await expect(client().exposePort({ threadId: 'thr_1', port: 4317 })).rejects.toThrow(
      'thread not found',
    )
  })

  it('throws with the status when the control plane fails', async () => {
    stubFetch(() => reply({ error: { message: 'boom' } }, 500))
    await expect(client().exposePort({ threadId: 'thr_1', port: 4317 })).rejects.toThrow('500')
  })

  it('composes the caller signal with its own timeout', async () => {
    stubFetch(() => reply({ result: { data: { url: 'https://x.test', tunnelToken: 't' } } }))
    const controller = new AbortController()
    await client().exposePort({ threadId: 'thr_1', port: 1, signal: controller.signal })
    controller.abort()
    expect(seen[0]?.init?.signal?.aborted).toBe(true)
  })
})

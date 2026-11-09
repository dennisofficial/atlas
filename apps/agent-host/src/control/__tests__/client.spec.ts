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

  it('posts a memory list and returns the snapshot the control plane sent', async () => {
    const snapshot = { project: 'o/r', memories: [] }
    stubFetch(() => reply({ result: { data: snapshot } }))
    const listed = await client().memory.list({ threadId: 'thr_1' })
    expect(listed).toEqual(snapshot)
    expect(seen[0]?.url).toBe(`${ORIGIN}/v1/trpc/hostMemory.list`)
    expect(seen[0]?.init?.body).toBe(JSON.stringify({ threadId: 'thr_1' }))
  })

  it('posts a memory write with its scope, name and body', async () => {
    stubFetch(() => reply({ result: { data: { memory: { name: 'm', revision: 1 } } } }))
    await client().memory.write({
      threadId: 'thr_1',
      scope: 'global',
      name: 'm',
      description: 'd',
      type: 'user',
      body: 'b',
    })
    expect(seen[0]?.url).toBe(`${ORIGIN}/v1/trpc/hostMemory.write`)
    expect(JSON.parse(String(seen[0]?.init?.body))).toEqual({
      threadId: 'thr_1',
      scope: 'global',
      name: 'm',
      description: 'd',
      type: 'user',
      body: 'b',
    })
  })

  it('turns a memory delete into its removed flag', async () => {
    stubFetch(() => reply({ result: { data: { removed: false } } }))
    const removed = await client().memory.remove({
      threadId: 'thr_1',
      scope: 'global',
      name: 'gone',
    })
    expect(removed).toBe(false)
    expect(seen[0]?.url).toBe(`${ORIGIN}/v1/trpc/hostMemory.remove`)
  })

  it('throws the message of a refused memory call', async () => {
    stubFetch(() => reply({ error: { json: { message: 'memory is at revision 2, not 1' } } }))
    await expect(
      client().memory.edit({
        threadId: 'thr_1',
        scope: 'global',
        name: 'm',
        old: 'a',
        new: 'b',
        revision: 1,
      }),
    ).rejects.toThrow('memory is at revision 2, not 1')
  })

  it('composes the caller signal with its own timeout', async () => {
    stubFetch(() => reply({ result: { data: { url: 'https://x.test', tunnelToken: 't' } } }))
    const controller = new AbortController()
    await client().exposePort({ threadId: 'thr_1', port: 1, signal: controller.signal })
    controller.abort()
    expect(seen[0]?.init?.signal?.aborted).toBe(true)
  })
})

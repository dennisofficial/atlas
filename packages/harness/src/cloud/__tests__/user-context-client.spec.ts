import { describe, expect, it } from 'bun:test'

import { CloudError } from '../cloud-transport'
import { UserContextClient } from '../user-context-client'

type Call = { url: string; method: string; headers: Record<string, string>; body?: unknown }

const harness = (replies: readonly { status?: number; body?: unknown }[]) => {
  const calls: Call[] = []
  let at = 0

  const fetchFn = (async (input: unknown, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string> | undefined
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: headers ?? {},
      ...(init?.body === undefined ? {} : { body: JSON.parse(String(init.body)) }),
    })
    const reply = replies[at]
    at += 1
    return new Response(reply?.body === undefined ? '' : JSON.stringify(reply.body), {
      status: reply?.status ?? 200,
    })
  }) as typeof fetch

  const client = new UserContextClient({
    url: 'https://cloud.test/',
    token: 'sandbox_tok',
    clientVersion: '1.2.3',
    fetchFn,
  })
  return { client, calls }
}

describe('reading the remote memory bundle', () => {
  it('gets the memory route and returns the bundle', async () => {
    const { client, calls } = harness([{ body: { bundle: '{"user/MEMORY.md":"x"}' } }])

    const bundle = await client.readMemoryBundle()

    expect(calls[0]?.method).toBe('GET')
    expect(calls[0]?.url).toBe('https://cloud.test/v1/user-context/memory')
    expect(calls[0]?.headers.authorization).toBe('Bearer sandbox_tok')
    expect(calls[0]?.headers['atlas-client-version']).toBe('1.2.3')
    expect(bundle).toBe('{"user/MEMORY.md":"x"}')
  })

  it('answers null when nothing has ever synced', async () => {
    const { client } = harness([{ body: { bundle: null } }])

    expect(await client.readMemoryBundle()).toBeNull()
  })

  it('surfaces a failure as a CloudError', async () => {
    const { client } = harness([{ status: 401, body: { message: 'expired session' } }])

    await expect(client.readMemoryBundle()).rejects.toBeInstanceOf(CloudError)
  })
})

describe('writing the remote memory bundle', () => {
  it('puts the bundle to the memory route', async () => {
    const { client, calls } = harness([{ status: 204 }])

    await client.writeMemoryBundle('{"user/MEMORY.md":"x"}')

    expect(calls[0]?.method).toBe('PUT')
    expect(calls[0]?.url).toBe('https://cloud.test/v1/user-context/memory')
    expect(calls[0]?.body).toEqual({ bundle: '{"user/MEMORY.md":"x"}' })
  })

  it('surfaces an over-cap rejection as a CloudError', async () => {
    const { client } = harness([{ status: 413, body: { message: 'over the limit' } }])

    const failure = await client.writeMemoryBundle('{}').catch((error) => error)

    expect(failure).toBeInstanceOf(CloudError)
    expect((failure as CloudError).status).toBe(413)
  })
})

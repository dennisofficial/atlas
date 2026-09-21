import { describe, expect, it } from 'bun:test'

import { CloudTransport } from '../cloud-transport'

const fakeFetch = (args: { status: number; body?: unknown; raw?: Uint8Array }): typeof fetch =>
  (async (input: unknown, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>
    expect(headers.authorization).toBe('Bearer sess_test')
    expect(headers['atlas-client-version']).toBe('1.2.3')
    expect(String(input)).toContain('https://cloud.test')
    if (args.raw !== undefined) return new Response(args.raw, { status: args.status })
    return new Response(args.body === undefined ? '' : JSON.stringify(args.body), {
      status: args.status,
    })
  }) as typeof fetch

describe('CloudTransport', () => {
  it('strips a trailing slash and reaches request() with the shared credentials', async () => {
    const transport = new CloudTransport({
      url: 'https://cloud.test/',
      token: 'sess_test',
      clientVersion: '1.2.3',
      fetchFn: fakeFetch({ status: 200, body: { ok: true } }),
    })

    await expect(transport.request({ method: 'GET', path: '/v1/threads' })).resolves.toEqual({ ok: true })
  })

  it('reaches rawRequest() with the same shared credentials', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const transport = new CloudTransport({
      url: 'https://cloud.test',
      token: 'sess_test',
      clientVersion: '1.2.3',
      fetchFn: fakeFetch({ status: 200, raw: bytes }),
    })

    await expect(
      transport.rawRequest({ method: 'GET', path: '/v1/user-context/memory', accept: 'application/gzip' }),
    ).resolves.toEqual(bytes)
  })
})

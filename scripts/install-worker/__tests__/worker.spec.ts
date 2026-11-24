import { afterEach, describe, expect, it } from 'bun:test'

import worker from '../worker.js'

const INDEX = { latest: 'tui-v1.2.3', tags: ['tui-v1.2.3', 'web-ota', 'tui-v1.2.2'] }
const BINARY = new TextEncoder().encode('a release binary')

type Object = { body: Uint8Array; range?: { offset: number; length: number } }

const rangeOf = (value: unknown): { offset: number; length: number } | undefined => {
  if (!(value instanceof Headers)) return undefined
  const match = /^bytes=(\d+)-(\d+)$/.exec(value.get('range') ?? '')
  if (match === null) return undefined
  const offset = Number(match[1])
  const end = Number(match[2])
  return { offset, length: end - offset + 1 }
}

const bucketOf = (objects: Record<string, Object>) => ({
  get: async (key: string, options?: { range?: unknown }) => {
    const object = objects[key]
    if (object === undefined) return null
    const range = rangeOf(options?.range)
    const body =
      range === undefined
        ? object.body
        : object.body.slice(range.offset, range.offset + range.length)
    const bytes = object.body
    return {
      body,
      size: bytes.byteLength,
      httpEtag: `"${key}"`,
      range,
      json: async () => JSON.parse(new TextDecoder().decode(bytes)),
    }
  },
  head: async (key: string) => {
    const object = objects[key]
    if (object === undefined) return null
    return { size: object.body.byteLength, httpEtag: `"${key}"` }
  },
})

const envOf = (objects: Record<string, Object> = {}) => ({
  RELEASES: bucketOf({
    'index.json': { body: new TextEncoder().encode(JSON.stringify(INDEX)) },
    'releases/tui-v1.2.3/atlas-linux-x64': { body: BINARY },
    ...objects,
  }),
})

const request = (path: string, init: RequestInit = {}): Request =>
  new Request(`https://install.byatlas.io${path}`, init)

const originalFetch = globalThis.fetch
const upstreamOf = (urls: Record<string, () => Response>) => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const handler = urls[url]
    return handler === undefined ? new Response('not found', { status: 404 }) : handler()
  }) as typeof fetch
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('install.sh routes', () => {
  it('serves install.sh from main at the bare domain', async () => {
    upstreamOf({
      'https://raw.githubusercontent.com/dennisofficial/atlas/main/install.sh': () =>
        new Response('#!/usr/bin/env sh\n'),
    })

    const response = await worker.fetch(request('/'), envOf())

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('#!/usr/bin/env sh\n')
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8')
  })

  it('serves a pinned install.sh and refuses anything else', async () => {
    upstreamOf({
      'https://raw.githubusercontent.com/dennisofficial/atlas/tui-v1.2.3/install.sh': () =>
        new Response('pinned'),
    })

    expect(await (await worker.fetch(request('/tui-v1.2.3'), envOf())).text()).toBe('pinned')
    expect((await worker.fetch(request('/whatever'), envOf())).status).toBe(404)
  })
})

describe('release downloads', () => {
  it('resolves releases/latest/download through the index and serves the bytes', async () => {
    const response = await worker.fetch(
      request('/releases/latest/download/atlas-linux-x64'),
      envOf(),
    )

    expect(response.status).toBe(200)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(BINARY)
    expect(response.headers.get('cache-control')).toBe('public, max-age=60')
    expect(response.headers.get('content-type')).toBe('application/octet-stream')
    expect(response.headers.get('accept-ranges')).toBe('bytes')
  })

  it('serves a tagged asset as immutable for longer and answers HEAD without a body', async () => {
    const response = await worker.fetch(
      request('/releases/download/tui-v1.2.3/atlas-linux-x64'),
      envOf(),
    )

    expect(response.headers.get('cache-control')).toBe('public, max-age=3600')

    const head = await worker.fetch(
      request('/releases/download/tui-v1.2.3/atlas-linux-x64', { method: 'HEAD' }),
      envOf(),
    )
    expect(head.status).toBe(200)
    expect(head.headers.get('content-length')).toBe(String(BINARY.byteLength))
    expect(await head.text()).toBe('')
  })

  it('answers a range request with 206 and the content range', async () => {
    const response = await worker.fetch(
      request('/releases/download/tui-v1.2.3/atlas-linux-x64', { headers: { range: 'bytes=2-5' } }),
      envOf(),
    )

    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe(`bytes 2-5/${BINARY.byteLength}`)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(BINARY.slice(2, 6))
  })

  it('falls back to github.com for an asset the mirror does not hold yet', async () => {
    upstreamOf({
      'https://github.com/dennisofficial/atlas/releases/download/tui-v1.2.2/atlas-linux-x64': () =>
        new Response('from github'),
    })

    const response = await worker.fetch(
      request('/releases/download/tui-v1.2.2/atlas-linux-x64'),
      envOf(),
    )

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('from github')
  })

  it('answers 404 when neither the mirror nor github has the asset', async () => {
    upstreamOf({})

    const response = await worker.fetch(
      request('/releases/latest/download/atlas-darwin-x64'),
      envOf(),
    )

    expect(response.status).toBe(404)
    expect(await response.text()).toContain('atlas-darwin-x64')
  })

  it('lists the mirrored tags for the update check', async () => {
    const response = await worker.fetch(request('/releases/tags'), envOf())

    expect(await response.json()).toEqual({ tags: INDEX.tags })
  })

  it('refuses a write', async () => {
    expect((await worker.fetch(request('/releases/tags', { method: 'PUT' }), envOf())).status).toBe(
      405,
    )
  })
})

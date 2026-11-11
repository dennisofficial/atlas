import { describe, expect, spyOn, test } from 'bun:test'

import type { ManifestEntry } from '@dltech/atlas-artifacts'

import { createBlobFetcher, createRouteFetcher, parseRouteObject } from '../route-object'

const LABEL = { token: 'k7f2m9qx', slug: 'dashboard' }

const entry: ManifestEntry = {
  path: 'index.html',
  tree: 'dist',
  sha256: 'a'.repeat(64),
  size: 12,
  type: 'text/html; charset=utf-8',
}

const route = {
  artifactId: 'art_1',
  slug: 'dashboard',
  name: 'Dashboard',
  version: 3,
  manifest: [entry],
}

const stubFetchOf = (body: () => Promise<Response>): typeof fetch =>
  Object.assign((): Promise<Response> => body(), { preconnect: (): void => undefined })

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

describe('parseRouteObject', () => {
  test('defaults to no serve rules on an object written before serve existed', () => {
    expect(parseRouteObject(route)).toEqual({
      ...route,
      manifest: [entry],
      serve: { spa: false },
    })
  })

  test('reads the serve rules from the routing object', () => {
    const parsed = parseRouteObject({ ...route, serve: { spa: true, notFound: '404.html' } })

    expect(parsed?.serve).toEqual({ spa: true, notFound: '404.html' })
  })

  test('reads serve rules that name no custom 404', () => {
    expect(parseRouteObject({ ...route, serve: { spa: true } })?.serve).toEqual({ spa: true })
  })

  test('rejects a non-object', () => {
    expect(parseRouteObject(null)).toBeNull()
    expect(parseRouteObject('route')).toBeNull()
    expect(parseRouteObject([route])).toBeNull()
  })

  test('rejects a missing field', () => {
    expect(parseRouteObject({ ...route, name: '' })).toBeNull()
    expect(parseRouteObject({ ...route, version: -1 })).toBeNull()
    expect(parseRouteObject({ ...route, version: 1.5 })).toBeNull()
    expect(parseRouteObject({ artifactId: 'art_1', slug: 'dashboard', version: 1 })).toBeNull()
  })

  test('answers null for a malformed manifest instead of throwing', () => {
    expect(parseRouteObject({ ...route, manifest: [] })).toEqual({
      ...route,
      manifest: [],
      serve: { spa: false },
    })
    expect(parseRouteObject({ ...route, manifest: [{ ...entry, type: '' }] })).toBeNull()
    expect(parseRouteObject({ ...route, manifest: [{ ...entry, sha256: 'nope' }] })).toBeNull()
    expect(parseRouteObject({ ...route, manifest: undefined })).toBeNull()
    expect(parseRouteObject({ ...route, manifest: [entry, entry] })).toBeNull()
  })

  test('rejects unparsable serve rules', () => {
    expect(parseRouteObject({ ...route, serve: { spa: 'yes' } })).toBeNull()
    expect(parseRouteObject({ ...route, serve: { notFound: '../escape.html' } })).toBeNull()
    expect(parseRouteObject({ ...route, serve: 'serve' })).toBeNull()
  })
})

describe('createRouteFetcher', () => {
  const baseUrl = 'https://blob.example'

  test('fetches the routing object by its host label', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch')
    fetchSpy.mockImplementation(stubFetchOf(() => Promise.resolve(jsonResponse(route))))
    try {
      expect(await createRouteFetcher(baseUrl)(LABEL)).toEqual({
        ...route,
        manifest: [entry],
        serve: { spa: false },
      })
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      expect(fetchSpy.mock.calls[0]?.[0]).toBe(
        'https://blob.example/routes/k7f2m9qx-dashboard.json',
      )
      expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({ cache: 'no-store' })
    } finally {
      fetchSpy.mockRestore()
    }
  })

  test('returns null when the routing object is absent', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch')
    fetchSpy.mockImplementation(
      stubFetchOf(() => Promise.resolve(new Response('missing', { status: 404 }))),
    )
    try {
      expect(await createRouteFetcher(baseUrl)(LABEL)).toBeNull()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  test('returns null when the body is not JSON', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch')
    fetchSpy.mockImplementation(
      stubFetchOf(() => Promise.resolve(new Response('not json', { status: 200 }))),
    )
    try {
      expect(await createRouteFetcher(baseUrl)(LABEL)).toBeNull()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  test('returns null when the store is unreachable', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch')
    fetchSpy.mockImplementation(stubFetchOf(() => Promise.reject(new Error('offline'))))
    try {
      expect(await createRouteFetcher(baseUrl)(LABEL)).toBeNull()
    } finally {
      fetchSpy.mockRestore()
    }
  })
})

describe('createBlobFetcher', () => {
  test('returns the stored response', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch')
    fetchSpy.mockImplementation(stubFetchOf(() => Promise.resolve(new Response('hello'))))
    try {
      const blob = await createBlobFetcher('https://blob.example/')('a'.repeat(64))
      expect(await blob?.text()).toBe('hello')
      expect(fetchSpy.mock.calls[0]?.[0]).toBe(`https://blob.example/blobs/${'a'.repeat(64)}`)
    } finally {
      fetchSpy.mockRestore()
    }
  })

  test('returns null for a missing blob', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch')
    fetchSpy.mockImplementation(
      stubFetchOf(() => Promise.resolve(new Response('missing', { status: 404 }))),
    )
    try {
      expect(await createBlobFetcher('https://blob.example')('a'.repeat(64))).toBeNull()
    } finally {
      fetchSpy.mockRestore()
    }
  })
})

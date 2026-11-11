import { describe, expect, spyOn, test } from 'bun:test'

import { createObjectFetcher, createRouteFetcher, parseRouteObject } from '../route-object'

const SUBDOMAIN = 'k7f2m9qxabcd'

const route = {
  artifactId: 'art_1',
  subdomain: SUBDOMAIN,
  name: 'Dashboard',
  serve: { spa: true, notFound: '404.html' },
}

const stubFetchOf = (body: () => Promise<Response>): typeof fetch =>
  Object.assign((): Promise<Response> => body(), { preconnect: (): void => undefined })

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

describe('parseRouteObject', () => {
  test('reads the serve rules from the route object', () => {
    expect(parseRouteObject(route)).toEqual(route)
  })

  test('defaults to no serve rules when the object has none', () => {
    const { serve: _serve, ...withoutServe } = route

    expect(parseRouteObject(withoutServe)).toEqual({ ...withoutServe, serve: { spa: false } })
  })

  test('rejects a non-object', () => {
    expect(parseRouteObject(null)).toBeNull()
    expect(parseRouteObject('route')).toBeNull()
    expect(parseRouteObject([route])).toBeNull()
  })

  test('rejects a missing or unusable label', () => {
    expect(parseRouteObject({ ...route, artifactId: '' })).toBeNull()
    expect(parseRouteObject({ ...route, name: '' })).toBeNull()
    expect(parseRouteObject({ ...route, subdomain: undefined })).toBeNull()
    expect(parseRouteObject({ ...route, subdomain: 'Not A Label' })).toBeNull()
  })

  test('rejects unparsable serve rules', () => {
    expect(parseRouteObject({ ...route, serve: { spa: 'yes' } })).toBeNull()
    expect(parseRouteObject({ ...route, serve: { notFound: '../escape.html' } })).toBeNull()
    expect(parseRouteObject({ ...route, serve: 'serve' })).toBeNull()
  })
})

describe('createRouteFetcher', () => {
  const baseUrl = 'https://blob.example'

  test('fetches the route object by its subdomain', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch')
    fetchSpy.mockImplementation(stubFetchOf(() => Promise.resolve(jsonResponse(route))))
    try {
      expect(await createRouteFetcher(baseUrl)(SUBDOMAIN)).toEqual(route)
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      expect(fetchSpy.mock.calls[0]?.[0]).toBe(`https://blob.example/routes/${SUBDOMAIN}.json`)
      expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({ cache: 'no-store' })
    } finally {
      fetchSpy.mockRestore()
    }
  })

  test('returns null when the route object is absent', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch')
    fetchSpy.mockImplementation(
      stubFetchOf(() => Promise.resolve(new Response('missing', { status: 404 }))),
    )
    try {
      expect(await createRouteFetcher(baseUrl)(SUBDOMAIN)).toBeNull()
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
      expect(await createRouteFetcher(baseUrl)(SUBDOMAIN)).toBeNull()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  test('returns null when the store is unreachable', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch')
    fetchSpy.mockImplementation(stubFetchOf(() => Promise.reject(new Error('offline'))))
    try {
      expect(await createRouteFetcher(baseUrl)(SUBDOMAIN)).toBeNull()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  test('returns null when the object belongs to another subdomain', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch')
    fetchSpy.mockImplementation(
      stubFetchOf(() => Promise.resolve(jsonResponse({ ...route, subdomain: 'zzzzzzzzzzzz' }))),
    )
    try {
      expect(await createRouteFetcher(baseUrl)(SUBDOMAIN)).toBeNull()
    } finally {
      fetchSpy.mockRestore()
    }
  })
})

describe('createObjectFetcher', () => {
  test('fetches a stored object by its key', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch')
    fetchSpy.mockImplementation(stubFetchOf(() => Promise.resolve(new Response('hello'))))
    try {
      const object = await createObjectFetcher('https://blob.example/')(
        'artifacts/k7f2m9qxabcd/_route/index.html',
      )
      expect(await object?.text()).toBe('hello')
      expect(fetchSpy.mock.calls[0]?.[0]).toBe(
        'https://blob.example/artifacts/k7f2m9qxabcd/_route/index.html',
      )
    } finally {
      fetchSpy.mockRestore()
    }
  })

  test('returns null for a missing object', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch')
    fetchSpy.mockImplementation(
      stubFetchOf(() => Promise.resolve(new Response('missing', { status: 404 }))),
    )
    try {
      expect(
        await createObjectFetcher('https://blob.example')('artifacts/x/_route/index.html'),
      ).toBeNull()
    } finally {
      fetchSpy.mockRestore()
    }
  })
})

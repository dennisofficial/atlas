import { describe, expect, test } from 'bun:test'

import {
  type ArtifactBucket,
  createObjectFetcher,
  createRouteFetcher,
  parseRouteObject,
} from '../route-object'
import { fakeBucketOf } from './fake-bucket'

const SUBDOMAIN = 'k7f2m9qxabcd'
const ROUTE_KEY = `routes/${SUBDOMAIN}.json`

const route = {
  artifactId: 'art_1',
  subdomain: SUBDOMAIN,
  name: 'Dashboard',
  serve: { spa: true, notFound: '404.html' },
  version: 3,
}

const failingBucket = (): ArtifactBucket => ({
  get: async () => {
    throw new Error('r2 unavailable')
  },
})

const textOf = async (stream: ReadableStream<Uint8Array>): Promise<string> =>
  new Response(stream).text()

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

  test('rejects a missing or unusable version', () => {
    expect(parseRouteObject({ ...route, version: undefined })).toBeNull()
    expect(parseRouteObject({ ...route, version: 0 })).toBeNull()
    expect(parseRouteObject({ ...route, version: -1 })).toBeNull()
    expect(parseRouteObject({ ...route, version: 1.5 })).toBeNull()
    expect(parseRouteObject({ ...route, version: '3' })).toBeNull()
  })

  test('rejects unparsable serve rules', () => {
    expect(parseRouteObject({ ...route, serve: { spa: 'yes' } })).toBeNull()
    expect(parseRouteObject({ ...route, serve: { notFound: '../escape.html' } })).toBeNull()
    expect(parseRouteObject({ ...route, serve: 'serve' })).toBeNull()
  })
})

describe('createRouteFetcher', () => {
  test('reads the route object of the subdomain from the bucket', async () => {
    const bucket = fakeBucketOf({ [ROUTE_KEY]: JSON.stringify(route) })

    expect(await createRouteFetcher(bucket)(SUBDOMAIN)).toEqual(route)
    expect(bucket.gets).toEqual([ROUTE_KEY])
  })

  test('returns null when the route object is absent', async () => {
    expect(await createRouteFetcher(fakeBucketOf())(SUBDOMAIN)).toBeNull()
  })

  test('returns null when the body is not JSON', async () => {
    expect(
      await createRouteFetcher(fakeBucketOf({ [ROUTE_KEY]: 'not json' }))(SUBDOMAIN),
    ).toBeNull()
  })

  test('returns null when the bucket throws', async () => {
    expect(await createRouteFetcher(failingBucket())(SUBDOMAIN)).toBeNull()
  })

  test('returns null when the object belongs to another subdomain', async () => {
    const bucket = fakeBucketOf({
      [ROUTE_KEY]: JSON.stringify({ ...route, subdomain: 'zzzzzzzzzzzz' }),
    })

    expect(await createRouteFetcher(bucket)(SUBDOMAIN)).toBeNull()
  })
})

describe('createObjectFetcher', () => {
  const KEY = `artifacts/${SUBDOMAIN}/_route/v${route.version}/index.html`

  test('reads a stored object and its etag by key', async () => {
    const object = await createObjectFetcher(fakeBucketOf({ [KEY]: 'hello' }))(KEY)

    expect(object).not.toBeNull()
    expect(object === null ? '' : await textOf(object.body)).toBe('hello')
    expect(object?.etag).toBeString()
  })

  test('returns null for a missing object', async () => {
    expect(await createObjectFetcher(fakeBucketOf())(KEY)).toBeNull()
  })

  test('returns null when the bucket throws', async () => {
    expect(await createObjectFetcher(failingBucket())(KEY)).toBeNull()
  })
})

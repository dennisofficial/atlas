import { describe, expect, test } from 'bun:test'

import worker, { type ArtifactHostEnv } from '../index'
import { fakeBucketOf } from './fake-bucket'

const ID = 'k7f2m9qxabcd'
const HOST = `${ID}.byatlas.site`
const DOMAIN = 'byatlas.site'

const HTML = '<!doctype html><title>dashboard</title>'
const APP_JS = 'console.log("app")'

const routeKey = `routes/${ID}.json`
const VERSION = 3
const indexKey = `artifacts/${ID}/_route/v${VERSION}/index.html`
const appKey = `artifacts/${ID}/_route/v${VERSION}/assets/app-1a2b3c4d.js`

const routeBodyOf = ({ spa = false }: { spa?: boolean } = {}): string =>
  JSON.stringify({
    artifactId: 'art_1',
    subdomain: ID,
    name: 'Dashboard',
    version: VERSION,
    serve: { spa },
  })

const published = (): Record<string, string> => ({
  [routeKey]: routeBodyOf(),
  [indexKey]: HTML,
  [appKey]: APP_JS,
})

const envOf = (
  files: Record<string, string> = published(),
): ArtifactHostEnv & {
  bucket: ReturnType<typeof fakeBucketOf>
} => {
  const bucket = fakeBucketOf(files)
  return { bucket, ARTIFACT_DOMAIN: DOMAIN, ARTIFACTS: bucket }
}

const requestOf = ({
  path = '/',
  headers,
}: {
  path?: string
  headers?: Record<string, string>
} = {}): Request => new Request(`https://${HOST}${path}`, { headers: headers ?? {} })

describe('artifact host worker', () => {
  test('answers 503 with no-store when the bucket binding is absent', async () => {
    const response = await worker.fetch(requestOf(), { ARTIFACT_DOMAIN: DOMAIN })

    expect(response.status).toBe(503)
    expect(await response.text()).toBe('artifact host is not configured')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('cdn-cache-control')).toBeNull()
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })

  test('serves a published document from the bucket as no-cache with an etag', async () => {
    const env = envOf()
    const response = await worker.fetch(requestOf(), env)

    expect(response.status).toBe(200)
    expect(await response.text()).toBe(HTML)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-cache')
    expect(response.headers.get('etag')).toBeString()
    expect(env.bucket.gets).toEqual([routeKey, indexKey])
  })

  test('serves a hashed asset as immutable', async () => {
    const response = await worker.fetch(requestOf({ path: '/assets/app-1a2b3c4d.js' }), envOf())

    expect(response.status).toBe(200)
    expect(await response.text()).toBe(APP_JS)
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
  })

  test('answers 304 with the same etag when If-None-Match matches', async () => {
    const env = envOf()
    const first = await worker.fetch(requestOf(), env)
    const etag = first.headers.get('etag') ?? ''
    await first.body?.cancel()

    const response = await worker.fetch(requestOf({ headers: { 'if-none-match': etag } }), env)

    expect(response.status).toBe(304)
    expect(await response.text()).toBe('')
    expect(response.headers.get('etag')).toBe(etag)
    expect(response.headers.get('cache-control')).toBe('no-cache')
  })

  test('serves the body when If-None-Match names another etag', async () => {
    const response = await worker.fetch(
      requestOf({ headers: { 'if-none-match': '"another"' } }),
      envOf(),
    )

    expect(response.status).toBe(200)
    expect(await response.text()).toBe(HTML)
  })

  test('answers 404 for a missing /sw.js rather than the SPA shell', async () => {
    const env = envOf({ [routeKey]: routeBodyOf({ spa: true }), [indexKey]: HTML })
    const response = await worker.fetch(requestOf({ path: '/sw.js' }), env)

    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).toContain('does not exist on this artifact')
  })

  test('serves the new body after an object is overwritten in the bucket', async () => {
    const env = envOf()
    const before = await worker.fetch(requestOf(), env)
    expect(await before.text()).toBe(HTML)

    const republished = '<!doctype html><title>republished</title>'
    env.bucket.write({ key: indexKey, text: republished })
    const after = await worker.fetch(requestOf(), env)

    expect(after.status).toBe(200)
    expect(await after.text()).toBe(republished)
    expect(after.headers.get('cache-control')).toBe('no-cache')
  })

  test('answers the atlas not-found page when the route object names no version', async () => {
    const legacy = JSON.stringify({
      artifactId: 'art_1',
      subdomain: ID,
      name: 'Dashboard',
      serve: { spa: false },
    })
    const response = await worker.fetch(
      requestOf({ path: '/legacy.html' }),
      envOf({ [routeKey]: legacy, [indexKey]: HTML }),
    )

    expect(response.status).toBe(404)
    expect(await response.text()).toContain('Artifact not found')
  })

  test('answers the atlas not-found page with no-store for an unknown artifact', async () => {
    const response = await worker.fetch(requestOf(), envOf({}))

    expect(response.status).toBe(404)
    expect(await response.text()).toContain('Artifact not found')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('cdn-cache-control')).toBeNull()
  })
})

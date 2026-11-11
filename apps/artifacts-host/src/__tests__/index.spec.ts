import { afterEach, describe, expect, test } from 'bun:test'

import worker, { type ArtifactHostEnv } from '../index'

const ID = 'k7f2m9qxabcd'
const HOST = `${ID}.byatlas.site`
const DOMAIN = 'byatlas.site'
const BASE_URL = 'https://store.example.test'

const HTML = '<!doctype html><title>dashboard</title>'

const routeUrl = `${BASE_URL}/routes/${ID}.json`
const indexUrl = `${BASE_URL}/artifacts/${ID}/_route/index.html`

const routeBody = JSON.stringify({
  artifactId: 'art_1',
  subdomain: ID,
  name: 'Dashboard',
  serve: { spa: false },
})

const envOf = (overrides: Partial<ArtifactHostEnv> = {}): ArtifactHostEnv => ({
  ARTIFACT_DOMAIN: DOMAIN,
  ARTIFACT_BLOB_BASE_URL: BASE_URL,
  ...overrides,
})

const originalFetch = globalThis.fetch

const stubBlobs = (files: Record<string, string>): string[] => {
  const urls: string[] = []
  const stubbed = async (input: string | URL | Request): Promise<Response> => {
    const url = input instanceof Request ? input.url : input.toString()
    urls.push(url)
    const body = files[url]
    return body === undefined ? new Response(null, { status: 404 }) : new Response(body)
  }
  globalThis.fetch = Object.assign(stubbed, { preconnect: (): void => {} })
  return urls
}

const requestOf = ({ path = '/' }: { path?: string } = {}): Request =>
  new Request(`https://${HOST}${path}`)

const published = (): Record<string, string> => ({
  [routeUrl]: routeBody,
  [indexUrl]: HTML,
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('artifact host worker', () => {
  test('answers 503 with no-store when the blob base url is absent', async () => {
    const response = await worker.fetch(requestOf(), { ARTIFACT_DOMAIN: DOMAIN })
    expect(response.status).toBe(503)
    expect(await response.text()).toBe('artifact host is not configured')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('cdn-cache-control')).toBe('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })

  test('answers 503 without touching the store when the blob base url is blank', async () => {
    const urls = stubBlobs(published())
    const response = await worker.fetch(requestOf(), envOf({ ARTIFACT_BLOB_BASE_URL: '   ' }))
    expect(response.status).toBe(503)
    expect(urls).toEqual([])
  })

  test('serves a published file from the configured blob store', async () => {
    const urls = stubBlobs(published())
    const response = await worker.fetch(requestOf(), envOf())
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(HTML)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe(
      'public, max-age=60, stale-while-revalidate=86400',
    )
    expect(urls).toEqual([routeUrl, indexUrl])
  })

  test('answers 404 with no-store for an unknown artifact', async () => {
    stubBlobs({})
    const response = await worker.fetch(requestOf(), envOf())
    expect(response.status).toBe(404)
    expect(await response.text()).toBe('')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('cdn-cache-control')).toBe('no-store')
  })
})

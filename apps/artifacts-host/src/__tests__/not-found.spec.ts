import { describe, expect, test } from 'bun:test'
import { subdomainOfLabel, type ArtifactSpec } from '@dltech/atlas-artifacts'

import type { HostSubdomain } from '../host-label'
import { artifactNotFoundHtml, deploymentNotFoundHtml } from '../pages'
import { respond } from '../respond'

const DOMAIN = 'byatlas.site'

const labelOf = (value: string): HostSubdomain => {
  const label = subdomainOfLabel(value)
  if (label === null) throw new Error(`unexpected subdomain ${value}`)
  return label
}

const routeOf = (serve: ArtifactSpec['serve']) => ({
  artifactId: 'a1',
  subdomain: labelOf('abc'),
  name: 'Atlas landing',
  serve,
})

const requestOf = ({ path, method = 'GET' }: { path: string; method?: string }): Request =>
  new Request(`https://abc.${DOMAIN}${path}`, { method })

const noObject = async (): Promise<Response | null> => null

describe('a deployment that is not there', () => {
  test('answers the atlas artifact page when no route object exists', async () => {
    const response = await respond({
      request: requestOf({ path: '/' }),
      domain: DOMAIN,
      fetchRoute: async () => null,
      fetchObject: noObject,
    })

    const html = await response.text()
    expect(response.status).toBe(404)
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
    expect(response.headers.get('Cache-Control')).toContain('no-store')
    expect(html).toContain('Artifact not found')
    expect(html).toContain('abc.byatlas.site')
    expect(html).not.toContain('does not exist on this artifact')
  })

  test('answers the atlas artifact page for a host that names no subdomain', async () => {
    const response = await respond({
      request: new Request(`https://${DOMAIN}/`),
      domain: DOMAIN,
      fetchRoute: async () => null,
      fetchObject: noObject,
    })

    expect(response.status).toBe(404)
    expect(await response.text()).toContain('Artifact not found')
  })

  test('escapes the host it echoes back', async () => {
    const html = artifactNotFoundHtml({ host: '<script>alert(1)</script>' })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})

describe('a missing path inside a deployment that exists', () => {
  test('answers the deployment page, not the atlas one', async () => {
    const response = await respond({
      request: requestOf({ path: '/nope' }),
      domain: DOMAIN,
      fetchRoute: async () => routeOf({ spa: false }),
      fetchObject: noObject,
    })

    const html = await response.text()
    expect(response.status).toBe(404)
    expect(html).toContain('does not exist on this artifact')
    expect(html).not.toContain('Artifact not found')
  })

  test('keeps the deployment page off any cache', async () => {
    const response = await respond({
      request: requestOf({ path: '/nope' }),
      domain: DOMAIN,
      fetchRoute: async () => routeOf({ spa: false }),
      fetchObject: noObject,
    })

    expect(response.headers.get('Cache-Control')).toContain('no-store')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })

  test('sends no body on HEAD', async () => {
    const response = await respond({
      request: requestOf({ path: '/nope', method: 'HEAD' }),
      domain: DOMAIN,
      fetchRoute: async () => routeOf({ spa: false }),
      fetchObject: noObject,
    })

    expect(response.status).toBe(404)
    expect(response.body).toBeNull()
  })

  test('serves the deployment own not-found file when it declares one', async () => {
    const response = await respond({
      request: requestOf({ path: '/nope' }),
      domain: DOMAIN,
      fetchRoute: async () => routeOf({ spa: false, notFound: '404.html' }),
      fetchObject: async (key) =>
        key.endsWith('404.html') ? new Response('<h1>custom missing</h1>') : null,
    })

    expect(response.status).toBe(404)
    expect(await response.text()).toContain('custom missing')
  })
})

describe('the pages themselves', () => {
  test('the deployment page carries no atlas branding', () => {
    const html = deploymentNotFoundHtml()
    expect(html).toContain('Not Found')
    expect(html.toLowerCase()).not.toContain('atlas')
  })
})

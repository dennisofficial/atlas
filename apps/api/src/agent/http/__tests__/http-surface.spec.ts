import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { startHttpApp, type RunningHttpApp } from './http-app'

const CALLBACK_PATH = '/mcp-oauth/callback'

describe('the agent host http surface', () => {
  let app: RunningHttpApp

  beforeAll(async () => {
    app = await startHttpApp()
  })

  afterAll(async () => {
    await app.close()
  })

  it('redirects a callback with state and renders the page without it', async () => {
    const redirect = await fetch(`${app.url}${CALLBACK_PATH}?state=abc`, { redirect: 'manual' })
    const page = await fetch(`${app.url}${CALLBACK_PATH}`)

    expect(redirect.status).toBe(302)
    expect(redirect.headers.get('location')).toContain('mcpOauth=connected')
    expect(page.status).toBe(200)
    expect(page.headers.get('content-type')).toContain('text/html')
    expect(await page.text()).toContain('<p>connected</p>')
  })

  it('answers the retired websocket stream path with 404', async () => {
    const plain = await fetch(`${app.url}/stream`)
    const upgrade = await fetch(`${app.url}/stream`, {
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        'Sec-WebSocket-Version': '13',
      },
    })

    expect(plain.status).toBe(404)
    expect(upgrade.status).toBe(404)
  })

  it('answers an unknown path with 404', async () => {
    const response = await fetch(`${app.url}/nope`)

    expect(response.status).toBe(404)
  })

  it('reports healthy until the drain starts and unhealthy while draining', async () => {
    const before = await fetch(`${app.url}/healthz`)
    expect(before.status).toBe(200)
    expect(await before.json()).toEqual({ ok: true, connections: 0 })

    app.stream.drain()

    const during = await fetch(`${app.url}/healthz`)
    expect(during.status).toBe(503)
    expect(await during.json()).toEqual({ ok: false, connections: 0 })
  })
})

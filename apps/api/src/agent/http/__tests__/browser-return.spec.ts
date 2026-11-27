import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { startHttpApp, type RunningHttpApp } from './http-app'

describe('the browser return start link', () => {
  let app: RunningHttpApp

  beforeAll(async () => {
    app = await startHttpApp()
  })

  afterAll(async () => {
    await app.close()
  })

  it('sends the browser to the provider with the surface cookie', async () => {
    const start = await fetch(`${app.url}/return/start/state-1?surface=ios&port=53682`, {
      redirect: 'manual',
    })

    expect(start.status).toBe(302)
    expect(start.headers.get('location')).toBe('https://provider.example/authorize?state=state-1')
    expect(start.headers.get('set-cookie')).toContain('atlas_return=ios:53682')
    expect(start.headers.get('cache-control')).toBe('no-store')
  })

  it('answers an expired start link with 410', async () => {
    const gone = await fetch(`${app.url}/return/start/gone`, { redirect: 'manual' })

    expect(gone.status).toBe(410)
    expect(gone.headers.get('cache-control')).toBe('no-store')
    expect(await gone.text()).toContain('expired')
  })
})

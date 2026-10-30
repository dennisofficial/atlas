import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { APP_INFO_PATH } from '../app-info'
import { createDesktopHost, type IDesktopHost } from '../index'

const SECRET = 'c'.repeat(64)
let host: IDesktopHost
let bare: IDesktopHost

beforeAll(() => {
  host = createDesktopHost({
    webRoot: '/nonexistent',
    apiOrigin: 'http://127.0.0.1:1',
    secret: SECRET,
    app: { version: '1.42.0', channel: 'stable' },
  })
  bare = createDesktopHost({
    webRoot: '/nonexistent',
    apiOrigin: 'http://127.0.0.1:1',
    secret: SECRET,
  })
})

afterAll(async () => {
  await host.stop()
  await bare.stop()
})

async function cookieFor(target: IDesktopHost): Promise<string> {
  const res = await fetch(`${target.url}/desktop/session?secret=${SECRET}`, {
    redirect: 'manual',
  })
  return (res.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
}

describe('desktop version route', () => {
  test('is guarded', async () => {
    expect((await fetch(`${host.url}${APP_INFO_PATH}`)).status).toBe(403)
  })

  test('reports the app version and channel', async () => {
    const headers = { cookie: await cookieFor(host) }
    const res = await fetch(`${host.url}${APP_INFO_PATH}`, { headers })
    expect(await res.json()).toEqual({ version: '1.42.0', channel: 'stable' })
  })

  test('is absent when the host has no app info', async () => {
    const headers = { cookie: await cookieFor(bare) }
    expect((await fetch(`${bare.url}${APP_INFO_PATH}`, { headers })).status).toBe(404)
  })
})

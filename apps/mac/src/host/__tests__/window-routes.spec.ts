import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createDesktopHost, type IDesktopHost } from '../index'

const SECRET = 'c'.repeat(64)
const PATH = '/desktop/window/titlebar-double-click'
let host: IDesktopHost
let doubleClicks = 0
const previewOrigins: string[][] = []
const ORIGINS_PATH = '/desktop/window/preview-origins'

beforeAll(() => {
  host = createDesktopHost({
    webRoot: '/nonexistent',
    apiOrigin: 'http://127.0.0.1:1',
    secret: SECRET,
    window: {
      titlebarDoubleClick: () => void (doubleClicks += 1),
      setPreviewOrigins: (origins) => void previewOrigins.push(origins),
    },
  })
})

afterAll(async () => {
  await host.stop()
})

async function cookie(): Promise<string> {
  const res = await fetch(`${host.url}/desktop/session?secret=${SECRET}`, { redirect: 'manual' })
  return (res.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
}

describe('desktop window routes', () => {
  test('are guarded', async () => {
    expect((await fetch(`${host.url}${PATH}`, { method: 'POST' })).status).toBe(403)
    expect(doubleClicks).toBe(0)
  })

  test('POST calls the port and GET is refused', async () => {
    const headers = { cookie: await cookie() }
    expect((await fetch(`${host.url}${PATH}`, { headers })).status).toBe(405)
    expect(doubleClicks).toBe(0)
    const res = await fetch(`${host.url}${PATH}`, { method: 'POST', headers })
    expect(res.status).toBe(204)
    expect(doubleClicks).toBe(1)
  })

  test('preview origins are guarded', async () => {
    const res = await fetch(`${host.url}${ORIGINS_PATH}`, {
      method: 'POST',
      body: JSON.stringify({ origins: ['https://a.vercel.run'] }),
    })
    expect(res.status).toBe(403)
    expect(previewOrigins).toEqual([])
  })

  test('preview origins POST normalizes to deduped origins', async () => {
    const headers = { cookie: await cookie(), 'content-type': 'application/json' }
    const post = (body: unknown) =>
      fetch(`${host.url}${ORIGINS_PATH}`, { method: 'POST', headers, body: JSON.stringify(body) })
    expect((await fetch(`${host.url}${ORIGINS_PATH}`, { headers })).status).toBe(405)
    expect((await post({ origins: ['javascript:alert(1)'] })).status).toBe(400)
    expect((await post({ origins: 'nope' })).status).toBe(400)
    const res = await post({
      origins: ['https://a.vercel.run/path?q=1', 'https://a.vercel.run/', 'http://localhost:3000'],
    })
    expect(res.status).toBe(204)
    expect(previewOrigins).toEqual([['https://a.vercel.run', 'http://localhost:3000']])
  })
})

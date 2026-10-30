import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createDesktopHost, type IDesktopHost } from '../index'

const SECRET = 'a'.repeat(64)
let host: IDesktopHost

beforeAll(() => {
  host = createDesktopHost({
    webRoot: '/nonexistent',
    apiOrigin: 'http://127.0.0.1:1',
    secret: SECRET,
  })
})

afterAll(async () => {
  await host.stop()
})

async function sessionCookie(): Promise<string> {
  const res = await fetch(`${host.url}/desktop/session?secret=${SECRET}`, { redirect: 'manual' })
  expect(res.status).toBe(302)
  expect(res.headers.get('location')).toBe('/')
  const setCookie = res.headers.get('set-cookie') ?? ''
  expect(setCookie).toContain('HttpOnly')
  expect(setCookie).toContain('SameSite=Strict')
  return setCookie.split(';')[0] ?? ''
}

describe('desktop guard', () => {
  test('session with wrong secret is 403', async () => {
    const res = await fetch(`${host.url}/desktop/session?secret=nope`, { redirect: 'manual' })
    expect(res.status).toBe(403)
  })

  test('no cookie is 403', async () => {
    expect((await fetch(`${host.url}/desktop/health`)).status).toBe(403)
  })

  test('wrong cookie is 403', async () => {
    const res = await fetch(`${host.url}/desktop/health`, {
      headers: { cookie: 'atlas_desktop=wrong' },
    })
    expect(res.status).toBe(403)
  })

  test('good cookie and host passes', async () => {
    const cookie = await sessionCookie()
    const res = await fetch(`${host.url}/desktop/health`, { headers: { cookie } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  test('good cookie with a foreign Host header is 403', async () => {
    const cookie = await sessionCookie()
    const res = await fetch(`${host.url}/desktop/health`, {
      headers: { cookie, host: 'evil.example' },
    })
    expect(res.status).toBe(403)
  })

  test('unknown desktop route behind the guard is 404', async () => {
    const cookie = await sessionCookie()
    expect((await fetch(`${host.url}/desktop/nope`, { headers: { cookie } })).status).toBe(404)
  })
})

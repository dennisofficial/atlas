import { describe, expect, it } from 'bun:test'

import { handlePreviewRequest } from '../worker'

const PREVIEW = '3000-abcdefghij.byatlas.dev'
const CALLBACK = 'https://callback.byatlas.dev'
const PREVIEW_COOKIE = `atlas-preview=${PREVIEW}; Domain=byatlas.dev; Path=/; Secure; HttpOnly; SameSite=None`

async function run(args: { url: string; init?: RequestInit; response?: () => Response }) {
  const seen: Request[] = []
  const result = await handlePreviewRequest({
    request: new Request(args.url, args.init),
    upstream: async (request) => {
      seen.push(request)
      return args.response?.() ?? new Response('upstream')
    },
  })
  return { result, seen }
}

const html = () =>
  new Response('<html><head></head></html>', { headers: { 'content-type': 'text/html' } })

describe('preview cookie', () => {
  it('marks the browser with the preview a top-level page came from', async () => {
    const { result } = await run({ url: `https://${PREVIEW}/login`, response: html })
    expect(result.headers.getSetCookie()).toContain(PREVIEW_COOKIE)
  })

  it('keeps it out of framed pages and non-HTML responses', async () => {
    const framed = await run({
      url: `https://${PREVIEW}/`,
      init: { headers: { 'sec-fetch-dest': 'iframe' } },
      response: html,
    })
    const json = await run({
      url: `https://${PREVIEW}/api`,
      response: () => new Response('{}', { headers: { 'content-type': 'application/json' } }),
    })
    expect(framed.result.headers.getSetCookie()).toEqual([])
    expect(json.result.headers.getSetCookie()).toEqual([])
  })

  it('leaves the app cookies partitioned beside it', async () => {
    const { result } = await run({
      url: `https://${PREVIEW}/`,
      response: () => {
        const response = html()
        response.headers.append('set-cookie', 'sid=1')
        return response
      },
    })
    expect(result.headers.getSetCookie()).toEqual([
      'sid=1; Secure; Partitioned; SameSite=None',
      PREVIEW_COOKIE,
    ])
  })
})

describe('callback host', () => {
  it('sends the callback to the marked preview with path and query intact', async () => {
    const { result, seen } = await run({
      url: `${CALLBACK}/api/auth/callback/google?code=c&state=s%2F1`,
      init: { headers: { cookie: `other=1; atlas-preview=${PREVIEW}` } },
    })
    expect(result.status).toBe(307)
    expect(result.headers.get('location')).toBe(
      `https://${PREVIEW}/api/auth/callback/google?code=c&state=s%2F1`,
    )
    expect(result.headers.get('cache-control')).toBe('no-store')
    expect(seen).toHaveLength(0)
  })

  it('keeps a form_post callback a POST', async () => {
    const { result } = await run({
      url: `${CALLBACK}/auth/apple`,
      init: { method: 'POST', body: 'code=c', headers: { cookie: `atlas-preview=${PREVIEW}` } },
    })
    expect(result.status).toBe(307)
    expect(result.headers.get('location')).toBe(`https://${PREVIEW}/auth/apple`)
  })

  it('marks the system browser for the Mac app on start and forwards to the provider', async () => {
    const google = `https://accounts.google.com/auth?redirect_uri=${encodeURIComponent(`${CALLBACK}/cb`)}&state=s`
    const { result } = await run({
      url: `${CALLBACK}/__atlas/start?to=${encodeURIComponent(google)}`,
    })
    expect(result.status).toBe(302)
    expect(result.headers.get('location')).toBe(google)
    expect(result.headers.getSetCookie()).toEqual([
      'atlas-preview=desktop; Domain=byatlas.dev; Path=/; Secure; HttpOnly; SameSite=None',
    ])
  })

  it.each([
    ['https://evil.com/'],
    ['https://accounts.google.com/auth?redirect_uri=https%3A%2F%2Fevil.com%2Fcb'],
    ['javascript:alert(1)'],
  ])('refuses a start that does not return to the callback host %p', async (to) => {
    const { result } = await run({ url: `${CALLBACK}/__atlas/start?to=${encodeURIComponent(to)}` })
    expect(result.status).toBe(400)
    expect(result.headers.get('location')).toBeNull()
    expect(result.headers.getSetCookie()).toEqual([])
  })

  it('hands a Mac app sign-in back through the atlas deep link', async () => {
    const { result, seen } = await run({
      url: `${CALLBACK}/api/auth/callback/google?code=c&state=%22%3C%2Fscript%3E`,
      init: { headers: { cookie: 'atlas-preview=desktop' } },
    })
    const page = await result.text()
    expect(result.status).toBe(200)
    expect(result.headers.get('cache-control')).toBe('no-store')
    expect(page).toContain(
      'href="atlas://preview-callback/api/auth/callback/google?code=c&amp;state=%22%3C%2Fscript%3E"',
    )
    expect(page).toContain(
      'window.location.href = "atlas://preview-callback/api/auth/callback/google?code=c&state=%22%3C%2Fscript%3E"',
    )
    expect(seen).toHaveLength(0)
  })

  it('refuses a posted callback for the Mac app', async () => {
    const { result } = await run({
      url: `${CALLBACK}/auth/apple`,
      init: { method: 'POST', body: 'code=c', headers: { cookie: 'atlas-preview=desktop' } },
    })
    expect(result.status).toBe(400)
  })

  it.each([
    [''],
    ['atlas-preview=evil.com'],
    ['atlas-preview=3000-abcdefghij.byatlas.dev.evil.com'],
    ['atlas-preview=callback.byatlas.dev'],
  ])('refuses without a valid preview cookie %p', async (cookie) => {
    const { result, seen } = await run({
      url: `${CALLBACK}/cb?code=c`,
      init: { headers: { cookie } },
    })
    expect(result.status).toBe(400)
    expect(result.headers.get('location')).toBeNull()
    expect(await result.text()).toContain('Open the preview in this browser')
    expect(seen).toHaveLength(0)
  })
})

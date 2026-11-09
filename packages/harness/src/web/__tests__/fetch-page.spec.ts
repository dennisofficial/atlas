import { afterAll, describe, expect, it } from 'bun:test'

import { EContentKind } from '@dltech/atlas-core'

import { EPageFormat, fetchPage } from '../fetch-page'

const page = (body: string, title = 'A page'): Response =>
  new Response(
    `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8' } },
  )

const target = Bun.serve({
  port: 0,
  fetch(request) {
    const path = new URL(request.url).pathname
    if (path === '/docs') return page('<h1>Docs</h1><a href="/guide/setup">Setup</a>')
    if (path === '/missing') return new Response('nope', { status: 404, statusText: 'Not Found' })
    if (path === '/archive')
      return new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), {
        headers: { 'content-type': 'application/zip' },
      })
    return page('<p>home</p>')
  },
})

const elsewhere = Bun.serve({
  port: 0,
  fetch() {
    return page('<h1>Moved</h1>', 'Moved page')
  },
})

const redirecting = Bun.serve({
  port: 0,
  fetch() {
    return new Response(null, {
      status: 302,
      headers: { location: `http://127.0.0.1:${elsewhere.port}/new-home` },
    })
  },
})

afterAll(() => {
  target.stop(true)
  elsewhere.stop(true)
  redirecting.stop(true)
})

const here = `http://localhost:${target.port}`

const signal = (): AbortSignal => AbortSignal.timeout(15_000)

describe('fetchPage', () => {
  it('reads a page as markdown with its links resolved against the page', async () => {
    const outcome = await fetchPage({
      url: `${here}/docs`,
      format: EPageFormat.Markdown,
      signal: signal(),
    })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.page.title).toBe('A page')
    expect(outcome.page.body).toContain('[Setup](')
    expect(outcome.page.body).toContain(`http://localhost:${target.port}/guide/setup`)
  })

  it('follows a redirect to another host', async () => {
    const outcome = await fetchPage({
      url: `http://localhost:${redirecting.port}/old-home`,
      format: EPageFormat.Markdown,
      signal: signal(),
    })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.page.finalUrl).toBe(`http://127.0.0.1:${elsewhere.port}/new-home`)
    expect(outcome.page.redirects).toEqual([`http://127.0.0.1:${elsewhere.port}/new-home`])
    expect(outcome.page.title).toBe('Moved page')
  })

  it('names the status a server answered with', async () => {
    const outcome = await fetchPage({
      url: `${here}/missing`,
      format: EPageFormat.Markdown,
      signal: signal(),
    })

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toContain('404')
  })

  it('hands a file back as bytes rather than refusing it', async () => {
    const outcome = await fetchPage({
      url: `${here}/archive`,
      format: EPageFormat.Markdown,
      signal: signal(),
    })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.page.kind).toBe(EContentKind.Binary)
    expect(outcome.page.body).toBe('')
    expect(outcome.bytes.byteLength).toBe(4)
  })

  it('reads a page served over plain http, as asked, without upgrading it', async () => {
    const outcome = await fetchPage({ url: `${here}/`, format: EPageFormat.Text, signal: signal() })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.page.finalUrl.startsWith('http://')).toBe(true)
  })
})

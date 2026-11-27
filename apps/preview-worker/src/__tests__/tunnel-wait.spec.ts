import { describe, expect, it } from 'bun:test'

import { STARTING_PAGE_RELOAD_SECONDS } from '../starting-page'
import { DEFAULT_TUNNEL_WAIT, type TunnelWait } from '../tunnel-wait'
import { handlePreviewRequest } from '../worker'

const HOST = 'https://3000-abcdefghij.byatlas.dev'

const cloudflareError = (status: number): Response =>
  new Response('<html><body><div id="cf-error-details"><h1>Bad gateway</h1></div></body></html>', {
    status,
    headers: {
      'content-type': 'text/html; charset=UTF-8',
      server: 'cloudflare',
      'retry-after': '60',
    },
  })

const originError = (): Response =>
  new Response('<html><body><h1>Internal Server Error</h1></body></html>', {
    status: 502,
    headers: { 'content-type': 'text/html' },
  })

const listing = (): Response =>
  new Response('<html><body><h1>Directory listing for /</h1></body></html>', {
    status: 200,
    headers: { 'content-type': 'text/html' },
  })

const waitOn = (args: { clock: { now: number }; sleeps: number[] }): TunnelWait => ({
  ...DEFAULT_TUNNEL_WAIT,
  now: () => args.clock.now,
  sleep: async (ms) => {
    args.sleeps.push(ms)
    args.clock.now += ms
  },
})

async function run(args: {
  answers: (() => Response)[]
  init?: RequestInit
  budgetMs?: number
  tries?: number
}) {
  const clock = { now: 0 }
  const sleeps: number[] = []
  const answers = args.answers
  let calls = 0
  const upstream = async (): Promise<Response> => {
    const next = answers[Math.min(calls, answers.length - 1)]
    calls += 1
    return next === undefined ? new Response('none') : next()
  }
  const result = await handlePreviewRequest({
    request: new Request(`${HOST}/`, args.init),
    upstream,
    tunnelWait: {
      ...waitOn({ clock, sleeps }),
      ...(args.budgetMs === undefined ? {} : { budgetMs: args.budgetMs }),
      ...(args.tries === undefined ? {} : { tries: args.tries }),
    },
  })
  return { result, calls, sleeps, elapsed: clock.now }
}

const navigation = { headers: { 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' } }
const subresource = { headers: { 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'script' } }

describe('waiting for the tunnel', () => {
  it('retries the edge error until the preview answers', async () => {
    const { result, calls, sleeps } = await run({
      answers: [() => cloudflareError(502), () => cloudflareError(502), listing],
      init: navigation,
    })
    expect(result.status).toBe(200)
    expect(await result.text()).toContain('Directory listing for /')
    expect(calls).toBe(3)
    expect(sleeps).toEqual([500, 1_000])
  })

  it('treats the 1033 page of a missing tunnel the same way', async () => {
    const { result, calls } = await run({ answers: [() => cloudflareError(530), listing] })
    expect(result.status).toBe(200)
    expect(calls).toBe(2)
  })

  it('does not retry a 502 the preview app itself sent', async () => {
    const { result, calls, sleeps } = await run({ answers: [originError] })
    expect(result.status).toBe(502)
    expect(await result.text()).toContain('Internal Server Error')
    expect(calls).toBe(1)
    expect(sleeps).toEqual([])
  })

  it('does not retry a write', async () => {
    const { result, calls } = await run({
      answers: [() => cloudflareError(502)],
      init: { method: 'POST', body: 'x' },
    })
    expect(result.status).toBe(502)
    expect(calls).toBe(1)
  })

  it('does not retry an answer that is not an edge error', async () => {
    const { result, calls, sleeps } = await run({ answers: [listing] })
    expect(result.status).toBe(200)
    expect(calls).toBe(1)
    expect(sleeps).toEqual([])
  })

  it('gives a document that is still waking the starting page', async () => {
    const { result, calls, elapsed } = await run({
      answers: [() => cloudflareError(502)],
      init: navigation,
      budgetMs: 1_200,
    })
    const text = await result.text()
    expect(result.status).toBe(503)
    expect(result.headers.get('retry-after')).toBe(String(STARTING_PAGE_RELOAD_SECONDS))
    expect(result.headers.get('cache-control')).toBe('no-store')
    expect(text).toContain(`content="${STARTING_PAGE_RELOAD_SECONDS}"`)
    expect(text).not.toContain('cf-error-details')
    expect(text).not.toContain('Bad gateway')
    expect(calls).toBe(3)
    expect(elapsed).toBeLessThan(3_000)
  })

  it('hands a subresource the edge error instead of a page', async () => {
    const { result } = await run({
      answers: [() => cloudflareError(502)],
      init: subresource,
      budgetMs: 1_200,
    })
    expect(result.status).toBe(502)
    expect(await result.text()).toContain('cf-error-details')
  })

  it('stops after a fixed number of tries', async () => {
    const { result, calls, elapsed } = await run({
      answers: [() => cloudflareError(502)],
      init: navigation,
    })
    expect(result.status).toBe(503)
    expect(calls).toBe(15)
    expect(elapsed).toBe(25_500)
  })

  it('stays inside the worker subrequest limit', async () => {
    const { calls } = await run({ answers: [() => cloudflareError(502)], init: navigation })
    expect(calls).toBeLessThan(50)
  })
})

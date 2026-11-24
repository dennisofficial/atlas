import { describe, expect, it } from 'bun:test'

import { EFreshness, type SearchRequest } from '../search'
import { jinaSearchOf } from '../search/jina'

type Recorded = { url: string; init: RequestInit | undefined }

const recordingFetch = (
  respond: (request: Recorded) => Promise<Response> | Response,
): { calls: Recorded[]; fetcher: typeof fetch } => {
  const calls: Recorded[] = []
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = { url: String(input), init }
    calls.push(request)
    return await respond(request)
  }) as typeof fetch
  return { calls, fetcher }
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const headerOf = (request: Recorded | undefined, name: string): string | null =>
  new Headers(request?.init?.headers).get(name)

const requestOf = (args: {
  query?: string
  count?: number
  site?: string
  fresh?: EFreshness
  gl?: string
  signal?: AbortSignal
}): SearchRequest => ({
  query: args.query ?? 'atlas agent',
  count: args.count ?? 5,
  signal: args.signal ?? new AbortController().signal,
  site: args.site,
  fresh: args.fresh,
  gl: args.gl,
})

const body = {
  code: 200,
  data: [
    {
      title: 'Atlas',
      url: 'https://example.com/atlas',
      description: 'a coding agent',
      date: '2026-11-20',
    },
  ],
}

describe('jina search port', () => {
  it('sends the query, the count and the key as headers on s.jina.ai', async () => {
    const { calls, fetcher } = recordingFetch(() => json(body))
    const port = jinaSearchOf({ key: 'jina-key', fetcher })

    await port.search(requestOf({ count: 4 }))

    const url = new URL(String(calls[0]?.url))
    expect(url.origin).toBe('https://s.jina.ai')
    expect(url.searchParams.get('q')).toBe('atlas agent')
    expect(url.searchParams.get('num')).toBe('4')
    expect(headerOf(calls[0], 'authorization')).toBe('Bearer jina-key')
    expect(headerOf(calls[0], 'accept')).toBe('application/json')
    expect(headerOf(calls[0], 'x-respond-with')).toBe('no-content')
    expect(headerOf(calls[0], 'x-site')).toBeNull()
  })

  it('passes the site, the freshness window and the country', async () => {
    const { calls, fetcher } = recordingFetch(() => json(body))
    const port = jinaSearchOf({ key: 'jina-key', fetcher })

    await port.search(requestOf({ site: 'zod.dev', fresh: EFreshness.Week, gl: 'us' }))

    const url = new URL(String(calls[0]?.url))
    expect(url.searchParams.get('gl')).toBe('us')
    expect(url.searchParams.get('tbs')).toBe('qdr:w')
    expect(headerOf(calls[0], 'x-site')).toBe('zod.dev')
  })

  it('maps a body to results with a snippet and a published date', async () => {
    const { fetcher } = recordingFetch(() => json(body))
    const port = jinaSearchOf({ key: 'jina-key', fetcher })

    const outcome = await port.search(requestOf({}))

    expect(outcome).toEqual({
      ok: true,
      results: [
        {
          title: 'Atlas',
          url: 'https://example.com/atlas',
          snippet: 'a coding agent',
          publishedAt: '2026-11-20',
        },
      ],
    })
  })

  it('skips a row with no url and falls back to the url for the title', async () => {
    const { fetcher } = recordingFetch(() =>
      json({ data: [{ title: 'no url' }, { url: 'https://example.com' }] }),
    )
    const port = jinaSearchOf({ key: 'jina-key', fetcher })

    const outcome = await port.search(requestOf({}))

    expect(outcome).toEqual({
      ok: true,
      results: [
        {
          title: 'https://example.com',
          url: 'https://example.com',
          snippet: undefined,
          publishedAt: undefined,
        },
      ],
    })
  })

  it('retries a quoted query once without the quotes when Jina finds nothing', async () => {
    let answer = json(
      { code: 422, message: 'AssertionFailureError: No search results available' },
      422,
    )
    const { calls, fetcher } = recordingFetch(() => {
      const first = answer
      answer = json(body)
      return first
    })
    const port = jinaSearchOf({ key: 'jina-key', fetcher })

    const outcome = await port.search(requestOf({ query: 'the "exact phrase" only' }))

    expect(calls).toHaveLength(2)
    expect(new URL(String(calls[0]?.url)).searchParams.get('q')).toBe('the "exact phrase" only')
    expect(new URL(String(calls[1]?.url)).searchParams.get('q')).toBe('the exact phrase only')
    expect(outcome.ok).toBe(true)
  })

  it('answers no results, not an error, when an unquoted query finds nothing', async () => {
    const { calls, fetcher } = recordingFetch(() =>
      json({ code: 422, message: 'AssertionFailureError: No search results available' }, 422),
    )
    const port = jinaSearchOf({ key: 'jina-key', fetcher })

    const outcome = await port.search(requestOf({ query: 'no such thing anywhere' }))

    expect(calls).toHaveLength(1)
    expect(outcome).toEqual({ ok: true, results: [] })
  })

  it('answers no results when the retry finds nothing either', async () => {
    const { fetcher } = recordingFetch(() =>
      json({ code: 422, message: 'AssertionFailureError: No search results available' }, 422),
    )
    const port = jinaSearchOf({ key: 'jina-key', fetcher })

    expect(await port.search(requestOf({ query: '"nothing" at all' }))).toEqual({
      ok: true,
      results: [],
    })
  })

  it('names a refused key, an empty balance, a rate limit and an outage in one sentence each', async () => {
    const reasonFor = async (status: number): Promise<string> => {
      const { fetcher } = recordingFetch(() => json({ message: 'raw body' }, status))
      const outcome = await jinaSearchOf({ key: 'jina-key', fetcher }).search(requestOf({}))
      return outcome.ok ? '' : outcome.reason
    }

    const elsewhere =
      'web_search stays down until the operator fixes it, so open a search page with the browser tool instead.'
    expect(await reasonFor(401)).toBe(`Jina refused the platform search key. ${elsewhere}`)
    expect(await reasonFor(403)).toBe(`Jina refused the platform search key. ${elsewhere}`)
    expect(await reasonFor(402)).toBe(
      `Jina refused the search because the platform Jina account has no balance. ${elsewhere}`,
    )
    expect(await reasonFor(429)).toBe('Jina is rate-limiting searches; try again in a moment.')
    expect(await reasonFor(503)).toBe('Jina search is down (status 503); try again shortly.')
    expect(await reasonFor(400)).toBe('Jina search failed with status 400.')
    expect(await reasonFor(422)).toBe('Jina search failed with status 422.')
  })

  it('never puts the raw body into a reason', async () => {
    const { fetcher } = recordingFetch(() => json({ error: 'secret-ish body' }, 500))

    const outcome = await jinaSearchOf({ key: 'jina-key', fetcher }).search(requestOf({}))

    expect(outcome.ok).toBe(false)
    expect(String(outcome.ok ? '' : outcome.reason)).not.toContain('{')
  })

  it('answers one sentence when Jina cannot be reached', async () => {
    const fetcher = (async () => {
      throw new Error('boom')
    }) as unknown as typeof fetch

    const outcome = await jinaSearchOf({ key: 'jina-key', fetcher }).search(requestOf({}))

    expect(outcome).toEqual({ ok: false, reason: 'could not reach Jina search: boom' })
  })

  it('answers one sentence when Jina does not answer in time', async () => {
    const fetcher = (async (_input: string | URL | Request, init?: RequestInit) =>
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })) as typeof fetch

    const outcome = await jinaSearchOf({ key: 'jina-key', fetcher, timeoutMs: 1000 }).search(
      requestOf({}),
    )

    expect(outcome).toEqual({ ok: false, reason: 'Jina search did not answer within 1 s.' })
  })

  it('answers one sentence when the operator interrupts the turn', async () => {
    const controller = new AbortController()
    const fetcher = (async (_input: string | URL | Request, init?: RequestInit) => {
      queueMicrotask(() => controller.abort())
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
    }) as unknown as typeof fetch

    const outcome = await jinaSearchOf({ key: 'jina-key', fetcher }).search(
      requestOf({ signal: controller.signal }),
    )

    expect(outcome).toEqual({
      ok: false,
      reason: 'the operator interrupted the turn while searching',
    })
  })

  it('answers one sentence when the host holds no key, without calling Jina', async () => {
    const { calls, fetcher } = recordingFetch(() => json(body))

    const outcome = await jinaSearchOf({ key: undefined, fetcher }).search(requestOf({}))

    expect(calls).toHaveLength(0)
    expect(outcome).toEqual({
      ok: false,
      reason: 'web_search has no Jina key on this host, so it cannot search.',
    })
  })

  it('answers one sentence for a body it cannot read', async () => {
    const { fetcher } = recordingFetch(() => new Response('not json', { status: 200 }))

    const outcome = await jinaSearchOf({ key: 'jina-key', fetcher }).search(requestOf({}))

    expect(outcome).toEqual({
      ok: false,
      reason: 'Jina answered the search with a body this tool could not read.',
    })
  })
})

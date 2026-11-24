import { describe, expect, it } from 'bun:test'

import { MAX_CHARACTERS, EPageFormat } from '../fetch-page'
import type { ReadArgs } from '../read'
import { jinaReaderOf } from '../read/jina-reader'

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

const readOf = (args: Partial<ReadArgs> = {}): ReadArgs => ({
  url: 'https://example.com/doc',
  format: EPageFormat.Markdown,
  signal: new AbortController().signal,
  ...args,
})

const data = {
  data: {
    title: 'Atlas',
    url: 'https://example.com/doc',
    finalUrl: 'https://example.com/doc-final',
    content: 'the page body',
  },
}

describe('jina reader port', () => {
  it('reads r.jina.ai with the key, the format and no images', async () => {
    const { calls, fetcher } = recordingFetch(() => json(data))

    await jinaReaderOf({ key: 'jina-key', fetcher }).read(readOf({ format: EPageFormat.Text }))

    expect(String(calls[0]?.url)).toBe('https://r.jina.ai/https://example.com/doc')
    expect(headerOf(calls[0], 'authorization')).toBe('Bearer jina-key')
    expect(headerOf(calls[0], 'accept')).toBe('application/json')
    expect(headerOf(calls[0], 'x-return-format')).toBe('text')
    expect(headerOf(calls[0], 'x-retain-images')).toBe('none')
    expect(headerOf(calls[0], 'x-timeout')).toBe('30')
  })

  it('maps the selector, remove and waitFor options to their headers', async () => {
    const { calls, fetcher } = recordingFetch(() => json(data))

    await jinaReaderOf({ key: 'jina-key', fetcher }).read(
      readOf({ selector: 'article', remove: 'nav,footer', waitFor: 'main', timeoutSeconds: 45 }),
    )

    expect(headerOf(calls[0], 'x-target-selector')).toBe('article')
    expect(headerOf(calls[0], 'x-remove-selector')).toBe('nav,footer')
    expect(headerOf(calls[0], 'x-wait-for-selector')).toBe('main')
    expect(headerOf(calls[0], 'x-timeout')).toBe('45')
  })

  it('asks for a browser render, with a 90 s timeout when none is given', async () => {
    const { calls, fetcher } = recordingFetch(() => json(data))

    await jinaReaderOf({ key: 'jina-key', fetcher }).read(readOf({ render: true }))

    expect(headerOf(calls[0], 'x-engine')).toBe('browser')
    expect(headerOf(calls[0], 'x-timeout')).toBe('90')
  })

  it('asks for one PDF page with OCR', async () => {
    const { calls, fetcher } = recordingFetch(() => json(data))

    await jinaReaderOf({ key: 'jina-key', fetcher }).read(readOf({ page: 2 }))

    expect(headerOf(calls[0], 'x-respond-with')).toBe('jina-ocr')
    expect(headerOf(calls[0], 'x-page')).toBe('2')
  })

  it('maps a body to a page that keeps the requested url and the final one', async () => {
    const { fetcher } = recordingFetch(() => json(data))

    const outcome = await jinaReaderOf({ key: 'jina-key', fetcher }).read(readOf({}))

    expect(outcome).toEqual({
      kind: 'page',
      page: {
        url: 'https://example.com/doc',
        finalUrl: 'https://example.com/doc-final',
        title: 'Atlas',
        bytes: 13,
        body: 'the page body',
        truncated: false,
      },
    })
  })

  it('cuts a body longer than the page cap and says so', async () => {
    const content = 'x'.repeat(MAX_CHARACTERS + 10)
    const { fetcher } = recordingFetch(() => json({ data: { content } }))

    const outcome = await jinaReaderOf({ key: 'jina-key', fetcher }).read(readOf({}))

    if (outcome.kind !== 'page') throw new Error('expected a page')
    expect(outcome.page.body).toHaveLength(MAX_CHARACTERS)
    expect(outcome.page.truncated).toBe(true)
  })

  it('names a missing page, a refused reader and a rate limit from the target status', async () => {
    const failedFor = async (httpStatus: string): Promise<string> => {
      const { fetcher } = recordingFetch(() => json({ data: { ...data.data, httpStatus } }))
      const outcome = await jinaReaderOf({ key: 'jina-key', fetcher }).read(readOf({}))
      return outcome.kind === 'failed' ? outcome.reason : outcome.kind
    }

    expect(await failedFor('404')).toBe(
      'example.com answered 404: the page does not exist. Find the right url with web_search rather than guessing another.',
    )
    expect(await failedFor('403')).toBe(
      'example.com answered 403 and refuses automated readers. Try render: true, or the browser tool.',
    )
    expect(await failedFor('429')).toBe('example.com is rate-limiting readers (429).')
    expect(await failedFor('500')).toBe('example.com answered 500.')
  })

  it('names a domain that does not resolve', async () => {
    const { fetcher } = recordingFetch(() =>
      json({ code: 422, message: 'SubmittedDataMalformedError: could not be resolved' }, 422),
    )

    const outcome = await jinaReaderOf({ key: 'jina-key', fetcher }).read(readOf({}))

    expect(outcome).toEqual({
      kind: 'failed',
      reason: 'example.com does not exist: its domain name does not resolve.',
    })
  })

  it('repeats Jina validation message for any other 422, cut to 200 characters', async () => {
    const message = `bad selector ${'x'.repeat(300)}`
    const { fetcher } = recordingFetch(() => json({ code: 422, message }, 422))

    const outcome = await jinaReaderOf({ key: 'jina-key', fetcher }).read(readOf({}))

    if (outcome.kind !== 'failed') throw new Error('expected a failure')
    expect(outcome.reason).toHaveLength(200)
    expect(outcome.reason.startsWith('bad selector')).toBe(true)
  })

  it('hands the page back to the direct fetch when it holds no key', async () => {
    const { calls, fetcher } = recordingFetch(() => json(data))

    const outcome = await jinaReaderOf({ key: undefined, fetcher }).read(readOf({}))

    expect(calls).toHaveLength(0)
    expect(outcome.kind).toBe('unavailable')
  })

  it('hands the page back to the direct fetch on a refusal, a rate limit and an outage', async () => {
    const kindFor = async (status: number): Promise<string> => {
      const { fetcher } = recordingFetch(() => json({ message: 'nope' }, status))
      const outcome = await jinaReaderOf({ key: 'jina-key', fetcher }).read(readOf({}))
      return outcome.kind
    }

    for (const status of [401, 402, 403, 409, 429, 500, 503]) {
      expect(await kindFor(status)).toBe('unavailable')
    }
  })

  it('hands the page back to the direct fetch when Jina cannot be reached', async () => {
    const fetcher = (async () => {
      throw new Error('boom')
    }) as unknown as typeof fetch

    const outcome = await jinaReaderOf({ key: 'jina-key', fetcher }).read(readOf({}))

    expect(outcome).toEqual({ kind: 'unavailable', reason: 'could not reach Jina reader: boom' })
  })
})

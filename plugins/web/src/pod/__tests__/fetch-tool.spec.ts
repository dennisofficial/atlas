import { describe, expect, it } from 'bun:test'

import { EContentKind, toThreadId, type FetchedPage } from '@dltech/atlas-core'

import { PageCache } from '../cache'
import { WebFetchTool } from '../fetch-tool'
import { EPageFormat, type PageOutcome } from '../fetch-page'
import { readerPortOf, type ReadArgs, type ReadOutcome, type ReaderPort } from '../read'

const pageOf = (overrides: Partial<FetchedPage> = {}): FetchedPage => ({
  url: 'https://example.com/doc',
  finalUrl: 'https://example.com/doc',
  bytes: 42,
  body: 'line one\nline two with atlas\nline three',
  truncated: false,
  contentType: 'text/html; charset=utf-8',
  kind: EContentKind.Html,
  ...overrides,
})

const readerOf = (outcome: ReadOutcome): { reader: ReaderPort; calls: ReadArgs[] } => {
  const calls: ReadArgs[] = []
  const reader: ReaderPort = {
    read: async (args) => {
      calls.push(args)
      return outcome
    },
  }
  return { reader, calls }
}

const directOf = (
  outcome: PageOutcome,
): { fetcher: typeof import('../fetch-page').fetchPage; calls: number[] } => {
  const calls: number[] = []
  const fetcher: typeof import('../fetch-page').fetchPage = async () => {
    calls.push(calls.length + 1)
    return outcome
  }
  return { fetcher, calls }
}

const invoke = (
  tool: WebFetchTool,
  input: Record<string, unknown>,
  signal = new AbortController().signal,
): Promise<{ ok: boolean; [key: string]: unknown }> =>
  tool.invoke({
    input,
    signal,
    idempotencyKey: 'key-1',
    projectDirectory: '/work/repo',
    activeWorktree: undefined,
    threadId: toThreadId('thr_1'),
  }) as Promise<{ ok: boolean; [key: string]: unknown }>

describe('WebFetchTool', () => {
  it('renders the Jina page inside the untrusted envelope and never runs the direct fetch', async () => {
    const { reader, calls } = readerOf({ kind: 'page', page: pageOf() })
    const direct = directOf({ ok: true, page: pageOf(), bytes: new Uint8Array() })
    const tool = new WebFetchTool({ reader, fetcher: direct.fetcher })

    const outcome = await invoke(tool, { url: 'https://example.com/doc' })

    expect(outcome.ok).toBe(true)
    expect(String(outcome.modelText)).toContain('line two with atlas')
    expect(String(outcome.modelText)).toContain('untrusted')
    expect(calls).toHaveLength(1)
    expect(direct.calls).toHaveLength(0)
  })

  it('handles an image from the direct fetch instead of reading it as text', async () => {
    const { reader } = readerOf({ kind: 'unavailable', reason: 'no key' })
    const direct = directOf({
      ok: true,
      page: pageOf({ kind: EContentKind.Image, contentType: 'image/png', body: '' }),
      bytes: new Uint8Array(),
    })
    const tool = new WebFetchTool({ reader, fetcher: direct.fetcher })

    const outcome = await invoke(tool, { url: 'https://example.com/pic.png' })

    expect(outcome.ok).toBe(true)
    expect(String(outcome.modelText)).toContain('image/png')
    expect(String(outcome.modelText)).toContain('curl -o')
  })

  it('narrows the body to the matching passages when a pattern is given', async () => {
    const body = ['first', 'second', 'third', 'fourth', 'fifth', 'atlas here', 'seventh'].join('\n')
    const { reader } = readerOf({ kind: 'page', page: pageOf({ body }) })
    const tool = new WebFetchTool({ reader })

    const outcome = await invoke(tool, { url: 'https://example.com/doc', pattern: 'atlas' })

    expect(outcome.ok).toBe(true)
    const found = outcome.output as { matched: number; body: string }
    expect(found.matched).toBe(1)
    expect(found.body).toContain('atlas here')
    expect(found.body).toContain('fourth')
    expect(found.body).not.toContain('first')
  })

  it('passes the reader every option the model gave', async () => {
    const { reader, calls } = readerOf({ kind: 'page', page: pageOf() })
    const tool = new WebFetchTool({ reader })

    await invoke(tool, {
      url: 'https://example.com/doc',
      format: EPageFormat.Text,
      timeout: 45,
      selector: 'article',
      remove: 'nav',
      waitFor: 'main',
      render: true,
      page: 2,
    })

    expect(calls[0]).toMatchObject({
      url: 'https://example.com/doc',
      format: EPageFormat.Text,
      timeoutSeconds: 45,
      selector: 'article',
      remove: 'nav',
      waitFor: 'main',
      render: true,
      page: 2,
    })
  })

  it('falls back to the direct fetch when Jina is unavailable', async () => {
    const { reader } = readerOf({
      kind: 'unavailable',
      reason: 'Jina reader is down (status 503).',
    })
    const direct = directOf({ ok: true, page: pageOf(), bytes: new Uint8Array() })
    const tool = new WebFetchTool({ reader, fetcher: direct.fetcher })

    const outcome = await invoke(tool, { url: 'https://example.com/doc' })

    expect(outcome.ok).toBe(true)
    expect(direct.calls).toHaveLength(1)
    expect(String(outcome.modelText)).toContain('line two with atlas')
  })

  it('falls back to the direct fetch when the host holds no Jina key', async () => {
    const direct = directOf({ ok: true, page: pageOf(), bytes: new Uint8Array() })
    const tool = new WebFetchTool({
      reader: readerPortOf({ jinaKey: undefined }),
      fetcher: direct.fetcher,
    })

    const outcome = await invoke(tool, { url: 'https://example.com/doc' })

    expect(outcome.ok).toBe(true)
    expect(direct.calls).toHaveLength(1)
  })

  it('says the direct fetch ignored a Jina-only option when it fell back', async () => {
    const { reader } = readerOf({ kind: 'unavailable', reason: 'no key' })
    const direct = directOf({ ok: true, page: pageOf(), bytes: new Uint8Array() })
    const tool = new WebFetchTool({ reader, fetcher: direct.fetcher })

    const outcome = await invoke(tool, { url: 'https://example.com/doc', render: true })

    expect(String(outcome.modelText)).toContain(
      'Jina was unavailable, so the page was fetched directly and selector/render/page were not applied.',
    )
  })

  it('reports a Jina failure about the target without running the direct fetch', async () => {
    const { reader } = readerOf({
      kind: 'failed',
      reason:
        'example.com answered 404: the page does not exist. Find the right url with web_search rather than guessing another.',
    })
    const direct = directOf({ ok: true, page: pageOf(), bytes: new Uint8Array() })
    const tool = new WebFetchTool({ reader, fetcher: direct.fetcher })

    const outcome = await invoke(tool, { url: 'https://example.com/gone' })

    expect(outcome.ok).toBe(false)
    expect(String(outcome.reason)).toContain('404')
    expect(direct.calls).toHaveLength(0)
  })

  it('serves a repeated fetch of the same url and options from the cache', async () => {
    const { reader, calls } = readerOf({ kind: 'page', page: pageOf() })
    const tool = new WebFetchTool({ reader })

    await invoke(tool, { url: 'https://example.com/doc' })
    const second = await invoke(tool, { url: 'https://example.com/doc' })

    expect(calls).toHaveLength(1)
    expect((second.output as { cached: boolean }).cached).toBe(true)
  })

  it('asks again when the format or a Jina option changes', async () => {
    const { reader, calls } = readerOf({ kind: 'page', page: pageOf() })
    const tool = new WebFetchTool({ reader })

    await invoke(tool, { url: 'https://example.com/doc' })
    await invoke(tool, { url: 'https://example.com/doc', format: EPageFormat.Text })
    await invoke(tool, { url: 'https://example.com/doc', render: true })
    await invoke(tool, { url: 'https://example.com/doc', selector: 'article' })

    expect(calls).toHaveLength(4)
  })

  it('forgets a page once the cache window has passed', () => {
    let now = 0
    const cache = new PageCache(() => now)
    const page = pageOf()
    const args = { url: page.url, variant: EPageFormat.Markdown }

    cache.write({ ...args, page })
    now += 15 * 60 * 1000 - 1
    expect(cache.read(args)).toBeDefined()
    now += 2
    expect(cache.read(args)).toBeUndefined()
  })
})

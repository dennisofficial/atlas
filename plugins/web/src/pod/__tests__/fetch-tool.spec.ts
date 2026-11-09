import { describe, expect, it } from 'bun:test'

import { EContentKind, toThreadId, type FetchedPage } from '@dltech/atlas-core'

import { PageCache } from '../cache'
import { WebFetchTool } from '../fetch-tool'
import { EPageFormat, type PageOutcome } from '../fetch-page'

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

const toolWith = (outcome: PageOutcome): { tool: WebFetchTool; calls: number[] } => {
  const calls: number[] = []
  const tool = new WebFetchTool({
    fetcher: async () => {
      calls.push(calls.length + 1)
      return outcome
    },
  })
  return { tool, calls }
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
  it('renders a whole page inside the untrusted envelope', async () => {
    const { tool } = toolWith({ ok: true, page: pageOf(), bytes: new Uint8Array() })
    const outcome = await invoke(tool, { url: 'https://example.com/doc' })

    expect(outcome.ok).toBe(true)
    expect(String(outcome.modelText)).toContain('line two with atlas')
    expect(String(outcome.modelText)).toContain('untrusted')
    expect(String(outcome.modelText)).toContain('https://example.com/doc')
  })

  it('narrows the body to the matching passages when a pattern is given', async () => {
    const body = ['first', 'second', 'third', 'fourth', 'fifth', 'atlas here', 'seventh'].join('\n')
    const { tool } = toolWith({ ok: true, page: pageOf({ body }), bytes: new Uint8Array() })
    const outcome = await invoke(tool, { url: 'https://example.com/doc', pattern: 'atlas' })

    expect(outcome.ok).toBe(true)
    const found = outcome.output as { matched: number; body: string }
    expect(found.matched).toBe(1)
    expect(found.body).toContain('atlas here')
    expect(found.body).toContain('fourth')
    expect(found.body).not.toContain('first')
  })

  it('reports an image instead of reading it as text', async () => {
    const { tool } = toolWith({
      ok: true,
      page: pageOf({ kind: EContentKind.Image, contentType: 'image/png', body: '' }),
      bytes: new Uint8Array(),
    })
    const outcome = await invoke(tool, { url: 'https://example.com/pic.png' })

    expect(outcome.ok).toBe(true)
    expect(String(outcome.modelText)).toContain('image/png')
    expect(String(outcome.modelText)).toContain('curl -o')
  })

  it('serves a repeated fetch of the same url and format from the cache', async () => {
    const { tool, calls } = toolWith({ ok: true, page: pageOf(), bytes: new Uint8Array() })
    await invoke(tool, { url: 'https://example.com/doc' })
    const second = await invoke(tool, { url: 'https://example.com/doc' })

    expect(calls).toHaveLength(1)
    expect((second.output as { cached: boolean }).cached).toBe(true)
  })

  it('asks again when the format changes', async () => {
    const { tool, calls } = toolWith({ ok: true, page: pageOf(), bytes: new Uint8Array() })
    await invoke(tool, { url: 'https://example.com/doc' })
    await invoke(tool, { url: 'https://example.com/doc', format: EPageFormat.Text })

    expect(calls).toHaveLength(2)
  })

  it('passes a failed fetch through as the reason', async () => {
    const { tool } = toolWith({ ok: false, reason: 'example.com answered 404 Not Found' })
    const outcome = await invoke(tool, { url: 'https://example.com/gone' })

    expect(outcome.ok).toBe(false)
    expect(String(outcome.reason)).toContain('404')
  })

  it('forgets a page once the cache window has passed', () => {
    let now = 0
    const cache = new PageCache(() => now)
    const page = pageOf()

    cache.write({ url: page.url, format: EPageFormat.Markdown, page })
    now += 15 * 60 * 1000 - 1
    expect(cache.read({ url: page.url, format: EPageFormat.Markdown })).toBeDefined()
    now += 2
    expect(cache.read({ url: page.url, format: EPageFormat.Markdown })).toBeUndefined()
  })
})

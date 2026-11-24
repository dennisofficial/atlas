import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'

import { EFreshness, type SearchPort, type SearchRequest } from '../search'
import { WebSearchTool } from '../search-tool'

const invoke = (
  tool: WebSearchTool,
  input: Record<string, unknown>,
): Promise<{ ok: boolean; [key: string]: unknown }> =>
  tool.invoke({
    input,
    signal: new AbortController().signal,
    idempotencyKey: 'key-1',
    projectDirectory: '/work/repo',
    activeWorktree: undefined,
    threadId: toThreadId('thr_1'),
  }) as Promise<{ ok: boolean; [key: string]: unknown }>

const portOf = (search: SearchPort['search']): SearchPort => ({ search })

describe('WebSearchTool', () => {
  it('renders the results inside one untrusted envelope, labelled Jina', async () => {
    const tool = new WebSearchTool(
      portOf(async () => ({
        ok: true,
        results: [{ title: 'Atlas', url: 'https://example.com/atlas', snippet: 'a harness' }],
      })),
    )

    const outcome = await invoke(tool, { query: 'atlas agent' })

    expect(outcome.ok).toBe(true)
    expect(String(outcome.modelText)).toContain('https://example.com/atlas')
    expect(String(outcome.modelText)).toContain('untrusted')
    expect(outcome.output).toMatchObject({ backend: 'jina', query: 'atlas agent' })
  })

  it('passes the query, the count, the site, the freshness and the country to the port', async () => {
    const seen: SearchRequest[] = []
    const tool = new WebSearchTool(
      portOf(async (request) => {
        seen.push(request)
        return { ok: true, results: [] }
      }),
    )

    await invoke(tool, {
      query: 'bun release',
      count: 3,
      site: 'zod.dev',
      fresh: EFreshness.Week,
      gl: 'us',
    })

    const first = seen[0]
    expect(first?.query).toBe('bun release')
    expect(first?.count).toBe(3)
    expect(first?.site).toBe('zod.dev')
    expect(first?.fresh).toBe(EFreshness.Week)
    expect(first?.gl).toBe('us')
  })

  it('defaults the count to 8', async () => {
    const seen: number[] = []
    const tool = new WebSearchTool(
      portOf(async ({ count }) => {
        seen.push(count)
        return { ok: true, results: [] }
      }),
    )

    await invoke(tool, { query: 'atlas' })

    expect(seen).toEqual([8])
  })

  it('returns the port refusal as the tool reason, unchanged', async () => {
    const tool = new WebSearchTool(portOf(async () => ({ ok: false, reason: 'Jina said no.' })))

    const outcome = await invoke(tool, { query: 'atlas' })

    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toBe('Jina said no.')
  })

  it('rejects a count above 20 and a country that is not two letters', async () => {
    const tool = new WebSearchTool(portOf(async () => ({ ok: true, results: [] })))

    expect((await invoke(tool, { query: 'atlas', count: 21 })).ok).toBe(false)
    expect((await invoke(tool, { query: 'atlas', gl: 'usa' })).ok).toBe(false)
  })
})

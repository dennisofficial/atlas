import type { WebSearchResult } from '@dltech/atlas-core'

import { bodyOf, messageOf, records, str } from '../payload'
import type { EFreshness, SearchPort, SearchRequest } from './contract'

const ENDPOINT = 'https://s.jina.ai/'

const DEFAULT_TIMEOUT_MS = 30_000

const NO_KEY = 'web_search has no Jina key on this host, so it cannot search.'

const RECENCY: Record<EFreshness, string> = {
  hour: 'qdr:h',
  day: 'qdr:d',
  week: 'qdr:w',
  month: 'qdr:m',
  year: 'qdr:y',
}

type Attempt =
  | { kind: 'results'; results: readonly WebSearchResult[] }
  | { kind: 'no-results' }
  | { kind: 'failed'; reason: string }

const urlOf = (request: SearchRequest): string => {
  const params = new URLSearchParams({ q: request.query, num: String(request.count) })
  if (request.gl !== undefined) params.set('gl', request.gl)
  if (request.fresh !== undefined) params.set('tbs', RECENCY[request.fresh])
  return `${ENDPOINT}?${params.toString()}`
}

const headersOf = (args: { key: string; site: string | undefined }): Record<string, string> => ({
  accept: 'application/json',
  authorization: `Bearer ${args.key}`,
  'x-respond-with': 'no-content',
  ...(args.site === undefined ? {} : { 'x-site': args.site }),
})

const resultsOf = (payload: Record<string, unknown> | undefined): readonly WebSearchResult[] =>
  records(payload?.['data']).flatMap((row): WebSearchResult[] => {
    const url = str(row['url'])
    if (url === undefined) return []
    return [
      {
        title: str(row['title']) ?? url,
        url,
        snippet: str(row['description']),
        publishedAt: str(row['date']),
      },
    ]
  })

const SEARCH_ELSEWHERE =
  'web_search stays down until the operator fixes it, so open a search page with `agent-browser` through bash instead.'

const statusFailure = (status: number): string => {
  if (status === 401 || status === 403)
    return `Jina refused the platform search key. ${SEARCH_ELSEWHERE}`
  if (status === 402)
    return `Jina refused the search because the platform Jina account has no balance. ${SEARCH_ELSEWHERE}`
  if (status === 429) return 'Jina is rate-limiting searches; try again in a moment.'
  if (status >= 500) return `Jina search is down (status ${status}); try again shortly.`
  return `Jina search failed with status ${status}.`
}

const attemptOf = async (args: {
  key: string
  fetcher: typeof fetch
  request: SearchRequest
  query: string
  timeoutMs: number
}): Promise<Attempt> => {
  const timer = AbortSignal.timeout(args.timeoutMs)
  const signal = AbortSignal.any([args.request.signal, timer])

  let response: Response
  try {
    response = await args.fetcher(urlOf({ ...args.request, query: args.query }), {
      headers: headersOf({ key: args.key, site: args.request.site }),
      signal,
    })
  } catch (error) {
    if (timer.aborted) {
      return {
        kind: 'failed',
        reason: `Jina search did not answer within ${args.timeoutMs / 1000} s.`,
      }
    }
    if (args.request.signal.aborted)
      return { kind: 'failed', reason: 'the operator interrupted the turn while searching' }
    return { kind: 'failed', reason: `could not reach Jina search: ${messageOf(error)}` }
  }

  if (response.status === 422) {
    const message = str((await bodyOf(response))?.['message']) ?? ''
    if (message.includes('No search results')) return { kind: 'no-results' }
    return { kind: 'failed', reason: statusFailure(422) }
  }
  if (!response.ok) return { kind: 'failed', reason: statusFailure(response.status) }

  const payload = await bodyOf(response)
  if (payload === undefined)
    return {
      kind: 'failed',
      reason: 'Jina answered the search with a body this tool could not read.',
    }

  return { kind: 'results', results: resultsOf(payload) }
}

export const jinaSearchOf = (args: {
  key: string | undefined
  fetcher?: typeof fetch | undefined
  timeoutMs?: number | undefined
}): SearchPort => {
  const fetcher = args.fetcher ?? fetch
  const key = args.key
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return {
    search: async (request) => {
      if (key === undefined) return { ok: false, reason: NO_KEY }

      const first = await attemptOf({ key, fetcher, request, query: request.query, timeoutMs })
      if (first.kind === 'results') return { ok: true, results: first.results }
      if (first.kind === 'failed') return { ok: false, reason: first.reason }
      if (!request.query.includes('"')) return { ok: true, results: [] }

      const second = await attemptOf({
        key,
        fetcher,
        request,
        query: request.query.replaceAll('"', ''),
        timeoutMs,
      })
      if (second.kind === 'results') return { ok: true, results: second.results }
      if (second.kind === 'failed') return { ok: false, reason: second.reason }
      return { ok: true, results: [] }
    },
  }
}

import type { WebSearchResult } from '@dltech/atlas-core'
import { Parser } from 'htmlparser2'

import type { SearchBackend } from './contract'

const ENDPOINT = 'https://www.bing.com/search'

const AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const classes = (attributes: Record<string, string>): string => attributes['class'] ?? ''

/**
 * Bing wraps every outbound link in a `/ck/a` redirect whose real target is base64url in the `u`
 * parameter, prefixed `a1`, so the href as written is never the result's own url.
 */
export function unwrapTarget(href: string): string | undefined {
  const absolute = href.startsWith('//') ? `https:${href}` : href

  let parsed: URL
  try {
    parsed = new URL(absolute, 'https://www.bing.com')
  } catch {
    return undefined
  }

  if (parsed.hostname.endsWith('bing.com') && parsed.pathname.startsWith('/ck/a')) {
    const wrapped = parsed.searchParams.get('u')
    if (wrapped === null) return undefined
    return decodeWrapped(wrapped)
  }

  return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : undefined
}

function decodeWrapped(value: string): string | undefined {
  const payload = value.startsWith('a1') ? value.slice(2) : value
  const base64 = payload.replaceAll('-', '+').replaceAll('_', '/')
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')

  try {
    const decoded = atob(padded)
    return decoded.startsWith('http') ? decoded : undefined
  } catch {
    return undefined
  }
}

type Pending = { title: string; url: string | undefined; snippet: string | undefined }

export function parseResults(html: string): readonly WebSearchResult[] {
  const found: WebSearchResult[] = []

  let inResult = false
  let inHeading = false
  let resultDepth = 0
  let pending: Pending | undefined
  let capturing: 'title' | 'snippet' | undefined
  let captureDepth = 0
  let buffer = ''

  const finishCapture = (): void => {
    const collected = buffer.replaceAll(/\s+/g, ' ').trim()
    if (pending !== undefined) {
      if (capturing === 'title') pending = { ...pending, title: collected }
      else if (capturing === 'snippet') pending = { ...pending, snippet: collected }
    }
    capturing = undefined
    captureDepth = 0
    buffer = ''
  }

  const finishResult = (): void => {
    if (pending?.url !== undefined && pending.title.length > 0) {
      found.push({
        title: pending.title,
        url: pending.url,
        ...(pending.snippet === undefined || pending.snippet.length === 0
          ? {}
          : { snippet: pending.snippet }),
      })
    }
    pending = undefined
    inResult = false
    inHeading = false
  }

  const parser = new Parser(
    {
      onopentag(name, attributes) {
        if (!inResult) {
          if (name === 'li' && classes(attributes).includes('b_algo')) {
            inResult = true
            resultDepth = 0
            pending = { title: '', url: undefined, snippet: undefined }
          }
          return
        }

        // Inside a captured element, nested tags only change how deep the capture is: the query
        // terms are wrapped in their own tags, so ending at the first close would keep a fragment.
        if (capturing !== undefined) {
          captureDepth += 1
          return
        }

        resultDepth += 1
        if (pending === undefined) return

        if (name === 'h2') {
          inHeading = true
          return
        }

        if (inHeading && name === 'a' && pending.url === undefined) {
          const target = unwrapTarget(attributes['href'] ?? '')
          if (target !== undefined) {
            pending = { ...pending, url: target }
            capturing = 'title'
            buffer = ''
          }
          return
        }

        if (name === 'p' && pending.title.length > 0 && pending.snippet === undefined) {
          capturing = 'snippet'
          buffer = ''
        }
      },
      ontext(text) {
        if (capturing !== undefined) buffer += text
      },
      onclosetag(name) {
        if (!inResult) return

        if (capturing !== undefined) {
          if (captureDepth > 0) {
            captureDepth -= 1
            return
          }
          finishCapture()
        }

        if (name === 'h2') inHeading = false

        resultDepth -= 1
        if (resultDepth < 0) finishResult()
      },
    },
    { decodeEntities: true },
  )

  parser.write(html)
  parser.end()

  return found
}

const BLOCKED = ['unusual traffic', 'captcha', 'prove you are a human', 'verify you are a human']

export const bing: SearchBackend = async ({ query, count, signal }) => {
  const url = new URL(ENDPOINT)
  url.searchParams.set('q', query)
  url.searchParams.set('count', String(count))
  url.searchParams.set('setlang', 'en')

  let response: Response
  try {
    response = await fetch(url, {
      headers: { accept: 'text/html', 'accept-language': 'en-US,en;q=0.9', 'user-agent': AGENT },
      signal,
    })
  } catch (error) {
    if (signal.aborted) return { ok: false, reason: 'the developer interrupted the turn' }
    return {
      ok: false,
      reason: `could not reach Bing: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  if (!response.ok) {
    return response.status === 429
      ? {
          ok: false,
          reason:
            'Bing rate-limited this search. It asks nothing of an ordinary search but throttles a burst, so wait a moment or pick a backend with a key in the settings.',
        }
      : { ok: false, reason: `Bing answered ${response.status}` }
  }

  const html = await response.text()
  const results = parseResults(html).slice(0, count)
  if (results.length === 0) {
    const body = html.toLowerCase()
    return {
      ok: false,
      reason: BLOCKED.some((marker) => body.includes(marker))
        ? 'Bing served a challenge instead of results. It does that to a burst of queries from one address, so wait a moment or pick a backend with a key in the settings.'
        : 'Bing answered with no results to read. Nothing may match the query, or its markup has changed.',
    }
  }

  return { ok: true, results }
}

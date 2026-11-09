import {
  absoluteLinks,
  acceptUrl,
  contentKindOf,
  EContentKind,
  type FetchedPage,
} from '@dltech/atlas-core'

import { htmlToMarkdown, htmlToText, titleOf } from './extract'
import { pdfToText } from './pdf'

export enum EPageFormat {
  Markdown = 'markdown',
  Text = 'text',
  Html = 'html',
}

const MAX_BYTES = 25 * 1024 * 1024

const MAX_CHARACTERS = 120_000

const MAX_REDIRECTS = 10

export const DEFAULT_TIMEOUT_SECONDS = 30

export const MAX_TIMEOUT_SECONDS = 120

const BROWSER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const HARNESS_AGENT = 'atlas'

// Cloudflare marks an interactive bot challenge with this header rather than a distinct status, and
// serves a plain response to a client that stops pretending to be a browser.
// https://developers.cloudflare.com/waf/reference/cf-mitigated/
const CHALLENGE_HEADER = 'cf-mitigated'

const ACCEPT: Record<EPageFormat, string> = {
  [EPageFormat.Markdown]:
    'text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1',
  [EPageFormat.Text]: 'text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1',
  [EPageFormat.Html]: 'text/html;q=1.0, application/xhtml+xml;q=0.9, */*;q=0.1',
}

export type PageFailure = { ok: false; reason: string }

export type PageSuccess = { ok: true; page: FetchedPage; bytes: Uint8Array }

export type PageOutcome = PageSuccess | PageFailure

const headersFor = (args: { format: EPageFormat; agent: string }): Record<string, string> => ({
  accept: ACCEPT[args.format],
  'accept-language': 'en-US,en;q=0.9',
  'user-agent': args.agent,
})

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

const proseOf = async (args: {
  bytes: Uint8Array
  kind: EContentKind
  format: EPageFormat
  finalUrl: string
  signal: AbortSignal
}): Promise<string> => {
  if (args.kind === EContentKind.Pdf)
    return await pdfToText({ bytes: args.bytes, signal: args.signal })

  const decoded = new TextDecoder().decode(args.bytes)
  if (args.kind !== EContentKind.Html) return decoded.trim()
  if (args.format === EPageFormat.Html) return decoded.trim()
  if (args.format === EPageFormat.Text) return htmlToText(decoded)
  return absoluteLinks({ markdown: htmlToMarkdown(decoded), base: args.finalUrl })
}

async function readBody(
  response: Response,
): Promise<{ ok: true; bytes: Uint8Array } | PageFailure> {
  const declared = Number(response.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    return {
      ok: false,
      reason: `the body declares ${declared} bytes, above the ${MAX_BYTES} limit`,
    }
  }

  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > MAX_BYTES) {
    return {
      ok: false,
      reason: `the body is ${bytes.byteLength} bytes, above the ${MAX_BYTES} limit`,
    }
  }

  return { ok: true, bytes }
}

export async function fetchPage(args: {
  url: string
  format: EPageFormat
  timeoutSeconds?: number | undefined
  signal: AbortSignal
  /** The url the caller asked for, carried through redirects so the page can name both. */
  requested?: string | undefined
}): Promise<PageOutcome> {
  const verdict = acceptUrl(args.url)
  if (!verdict.ok) return { ok: false, reason: verdict.reason }

  const requested = args.requested ?? verdict.url

  const seconds = Math.min(args.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS)
  const timer = AbortSignal.timeout(seconds * 1000)
  const signal = AbortSignal.any([args.signal, timer])

  const send = async (url: string): Promise<Response> => {
    const request = async (agent: string): Promise<Response> =>
      await fetch(url, {
        headers: headersFor({ format: args.format, agent }),
        redirect: 'manual',
        signal,
      })

    const response = await request(BROWSER_AGENT)
    if (response.status === 403 && response.headers.has(CHALLENGE_HEADER))
      return await request(HARNESS_AGENT)
    return response
  }

  let current = verdict.url
  const redirects: string[] = []

  for (;;) {
    let response: Response
    try {
      response = await send(current)
    } catch (error) {
      if (timer.aborted)
        return { ok: false, reason: `${hostOf(current)} did not answer within ${seconds}s` }
      if (args.signal.aborted)
        return { ok: false, reason: 'the developer interrupted the turn while fetching' }
      return {
        ok: false,
        reason: `could not reach ${hostOf(current)}: ${error instanceof Error ? error.message : String(error)}`,
      }
    }

    const location = response.headers.get('location')
    if (response.status >= 300 && response.status < 400 && location !== null) {
      const hop = new URL(location, current).toString()
      const allowed = acceptUrl(hop)
      if (!allowed.ok)
        return { ok: false, reason: `${current} redirects to ${hop}: ${allowed.reason}` }
      if (redirects.length >= MAX_REDIRECTS) {
        return {
          ok: false,
          reason: `${requested} redirected more than ${MAX_REDIRECTS} times: ${[...redirects, hop].join(' → ')}`,
        }
      }
      redirects.push(allowed.url)
      current = allowed.url
      continue
    }

    if (!response.ok) {
      return {
        ok: false,
        reason: `${hostOf(current)} answered ${response.status} ${response.statusText}`.trim(),
      }
    }

    const read = await readBody(response)
    if (!read.ok) return read

    const contentType = response.headers.get('content-type') ?? ''
    const kind = contentKindOf({ contentType, bytes: read.bytes })

    const pageOf = (body: string, truncated: boolean, title?: string): PageSuccess => ({
      ok: true,
      bytes: read.bytes,
      page: {
        url: requested,
        finalUrl: current,
        ...(title === undefined ? {} : { title }),
        bytes: read.bytes.byteLength,
        body,
        truncated,
        contentType,
        kind,
        ...(redirects.length === 0 ? {} : { redirects }),
      },
    })

    if (kind === EContentKind.Image || kind === EContentKind.Binary) return pageOf('', false)

    const prose = await proseOf({
      bytes: read.bytes,
      kind,
      format: args.format,
      finalUrl: current,
      signal,
    })
    const truncated = prose.length > MAX_CHARACTERS

    return pageOf(
      truncated ? prose.slice(0, MAX_CHARACTERS) : prose,
      truncated,
      kind === EContentKind.Html ? titleOf(new TextDecoder().decode(read.bytes)) : undefined,
    )
  }
}

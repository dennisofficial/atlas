import { bodyOf, messageOf, recordOf, str } from '../payload'
import { DEFAULT_TIMEOUT_SECONDS, MAX_CHARACTERS, MAX_TIMEOUT_SECONDS } from '../fetch-page'
import type { ReadArgs, ReadOutcome, ReaderPort } from './contract'

const ENDPOINT = 'https://r.jina.ai/'

const RENDER_SECONDS = 90

const ABORT_GRACE_SECONDS = 15

const MAX_MESSAGE_CHARS = 200

const NO_KEY = 'web_fetch has no Jina key on this host, so it reads pages directly.'

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

const secondsOf = (args: ReadArgs): number => {
  const wanted =
    args.timeoutSeconds ?? (args.render === true ? RENDER_SECONDS : DEFAULT_TIMEOUT_SECONDS)
  return Math.min(wanted, MAX_TIMEOUT_SECONDS)
}

const headersOf = (args: ReadArgs & { key: string }): Record<string, string> => ({
  accept: 'application/json',
  authorization: `Bearer ${args.key}`,
  'x-return-format': args.format,
  'x-retain-images': 'none',
  'x-timeout': String(secondsOf(args)),
  ...(args.selector === undefined ? {} : { 'x-target-selector': args.selector }),
  ...(args.remove === undefined ? {} : { 'x-remove-selector': args.remove }),
  ...(args.waitFor === undefined ? {} : { 'x-wait-for-selector': args.waitFor }),
  ...(args.render === true ? { 'x-engine': 'browser' } : {}),
  ...(args.page === undefined ? {} : { 'x-respond-with': 'jina-ocr', 'x-page': String(args.page) }),
})

const targetFailureOf = (args: { host: string; status: number }): string => {
  if (args.status === 404 || args.status === 410) {
    return `${args.host} answered ${args.status}: the page does not exist. Find the right url with web_search rather than guessing another.`
  }
  if (args.status === 401 || args.status === 403) {
    return `${args.host} answered ${args.status} and refuses automated readers. Try render: true, or the browser tool.`
  }
  if (args.status === 429) return `${args.host} is rate-limiting readers (429).`
  return `${args.host} answered ${args.status}.`
}

const unavailableOf = (status: number): string => {
  if (status === 401 || status === 403) return 'Jina refused the platform reader key.'
  if (status === 402)
    return 'Jina refused the read because the platform Jina account has no balance.'
  if (status === 409) return 'Jina is busy for this page (409).'
  if (status === 429) return 'Jina is rate-limiting readers (429).'
  if (status >= 500) return `Jina reader is down (status ${status}).`
  return `Jina could not read the page (status ${status}).`
}

const pageOf = (args: { url: string; data: Record<string, unknown> }): ReadOutcome => {
  const content = str(args.data['content'])
  if (content === undefined)
    return {
      kind: 'unavailable',
      reason: `Jina read ${hostOf(args.url)} but returned no page body.`,
    }

  const truncated = content.length > MAX_CHARACTERS
  const title = str(args.data['title'])
  return {
    kind: 'page',
    page: {
      url: args.url,
      finalUrl: str(args.data['finalUrl']) ?? args.url,
      ...(title === undefined ? {} : { title }),
      bytes: new TextEncoder().encode(content).byteLength,
      body: truncated ? content.slice(0, MAX_CHARACTERS) : content,
      truncated,
    },
  }
}

const answeredOf = async (args: { response: Response; url: string }): Promise<ReadOutcome> => {
  const payload = await bodyOf(args.response)
  if (payload === undefined) {
    return {
      kind: 'unavailable',
      reason: 'Jina answered the read with a body this tool could not read.',
    }
  }

  if (args.response.status === 422) {
    const message = str(payload['message']) ?? ''
    if (message.includes('could not be resolved')) {
      return {
        kind: 'failed',
        reason: `${hostOf(args.url)} does not exist: its domain name does not resolve.`,
      }
    }
    return {
      kind: 'failed',
      reason:
        message.length === 0
          ? 'Jina refused the read as malformed. Check the url and the selectors.'
          : message.slice(0, MAX_MESSAGE_CHARS),
    }
  }
  if (args.response.status !== 200) {
    return { kind: 'unavailable', reason: unavailableOf(args.response.status) }
  }

  const data = recordOf(payload['data'])
  if (data === undefined)
    return {
      kind: 'failed',
      reason: 'Jina answered the read with a body this tool could not read.',
    }

  const httpStatus = Number(data['httpStatus'] ?? 0)
  if (Number.isFinite(httpStatus) && httpStatus >= 400) {
    return {
      kind: 'failed',
      reason: targetFailureOf({ host: hostOf(args.url), status: httpStatus }),
    }
  }

  return pageOf({ url: args.url, data })
}

export const jinaReaderOf = (args: {
  key: string | undefined
  fetcher?: typeof fetch | undefined
}): ReaderPort => {
  const fetcher = args.fetcher ?? fetch
  const key = args.key

  return {
    read: async (read) => {
      if (key === undefined) return { kind: 'unavailable', reason: NO_KEY }

      const seconds = secondsOf(read)
      const timer = AbortSignal.timeout((seconds + ABORT_GRACE_SECONDS) * 1000)
      const signal = AbortSignal.any([read.signal, timer])

      let response: Response
      try {
        response = await fetcher(`${ENDPOINT}${read.url}`, {
          headers: headersOf({ ...read, key }),
          signal,
        })
      } catch (error) {
        if (timer.aborted)
          return { kind: 'unavailable', reason: 'Jina did not answer the read in time.' }
        if (read.signal.aborted)
          return { kind: 'unavailable', reason: 'the operator interrupted the read.' }
        return { kind: 'unavailable', reason: `could not reach Jina reader: ${messageOf(error)}` }
      }

      return await answeredOf({ response, url: read.url })
    },
  }
}

export class CloudError extends Error {
  readonly status: number

  constructor(args: { status: number; message: string }) {
    super(args.message)
    this.name = 'CloudError'
    this.status = args.status
  }
}

export const isCloudUnavailable = (error: unknown): boolean =>
  error instanceof CloudError && (error.status === 0 || error.status >= 500)

/**
 * A 429 or a reset mid-turn must never be fatal: these are the injectable defaults behind the
 * opt-in `retry` flag, sized so a throttled read settles well inside a client's own reconnect
 * window rather than compounding it.
 */
export const DEFAULT_RETRY_MAX_ATTEMPTS = 4
export const DEFAULT_RETRY_BASE_DELAY_MS = 500
export const DEFAULT_RETRY_CEILING_DELAY_MS = 8_000

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const isRetryableStatus = (status: number): boolean => status === 429 || status >= 500

const retryAfterMs = (response: Response): number | undefined => {
  const retryAfter = response.headers.get('retry-after')
  if (retryAfter === null) return undefined
  const seconds = Number.parseFloat(retryAfter)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined
}

const backoffDelayMs = (args: {
  attempt: number
  baseDelayMs: number
  ceilingDelayMs: number
  randomFn: () => number
}): number => {
  const exponential = Math.min(args.ceilingDelayMs, args.baseDelayMs * 2 ** args.attempt)
  return exponential * args.randomFn()
}

const detailFrom = (body: unknown): string | undefined => {
  if (typeof body !== 'object' || body === null) return undefined

  const message = Reflect.get(body, 'message')
  if (typeof message === 'string' && message.length > 0) return message
  if (Array.isArray(message) && message.every((part) => typeof part === 'string'))
    return message.join('; ')

  const error = Reflect.get(body, 'error')
  if (typeof error === 'string' && error.length > 0) return error

  return undefined
}

const safeJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

export const cloudRequest = async (args: {
  url: string
  token: string
  clientVersion: string
  fetchFn: typeof fetch
  method: string
  path: string
  body?: unknown
  allowMissing?: boolean
  /** Opt in for GETs and other idempotent calls only — a mutation stays single-shot. */
  retry?: boolean
  sleep?: ((ms: number) => Promise<void>) | undefined
  randomFn?: (() => number) | undefined
  maxAttempts?: number
  baseDelayMs?: number
  ceilingDelayMs?: number
}): Promise<unknown> => {
  const sleep = args.sleep ?? defaultSleep
  const randomFn = args.randomFn ?? Math.random
  const retry = args.retry === true
  const maxAttempts = args.maxAttempts ?? DEFAULT_RETRY_MAX_ATTEMPTS
  const baseDelayMs = args.baseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS
  const ceilingDelayMs = args.ceilingDelayMs ?? DEFAULT_RETRY_CEILING_DELAY_MS

  for (let attempt = 0; ; attempt += 1) {
    const attemptsLeft = retry && attempt < maxAttempts - 1

    let response: Response
    try {
      response = await args.fetchFn(`${args.url}${args.path}`, {
        method: args.method,
        headers: {
          authorization: `Bearer ${args.token}`,
          'atlas-client-version': args.clientVersion,
          ...(args.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(args.body === undefined ? {} : { body: JSON.stringify(args.body) }),
      })
    } catch (cause) {
      if (attemptsLeft) {
        await sleep(backoffDelayMs({ attempt, baseDelayMs, ceilingDelayMs, randomFn }))
        continue
      }
      throw new CloudError({
        status: 0,
        message: `The Atlas Cloud API at ${args.url} could not be reached: ${cause instanceof Error ? cause.message : String(cause)}.`,
      })
    }

    const text = await response.text()

    if (attemptsLeft && isRetryableStatus(response.status)) {
      const afterMs = retryAfterMs(response)
      await sleep(
        afterMs === undefined
          ? backoffDelayMs({ attempt, baseDelayMs, ceilingDelayMs, randomFn })
          : Math.min(afterMs, ceilingDelayMs),
      )
      continue
    }

    const parsed: unknown = text.length === 0 ? undefined : safeJson(text)

    if (response.status === 404 && args.allowMissing === true) return undefined

    if (!response.ok) {
      const detail = detailFrom(parsed)
      throw new CloudError({
        status: response.status,
        message: `The Atlas Cloud API answered ${args.method} ${args.path} with ${response.status}${detail === undefined ? '' : `: ${detail}`}.`,
      })
    }

    return parsed
  }
}

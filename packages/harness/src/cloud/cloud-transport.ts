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
 * A refusal is the API answering, not failing: the session token itself was rejected, so cached
 * data behind it is forfeit and the operator has to sign back in. 401/402/403 only — a 404 is a
 * missing resource, not a dead session.
 */
export const isCloudRefusal = (error: unknown): boolean =>
  error instanceof CloudError && [401, 402, 403].includes(error.status)

/**
 * A 429 or a reset mid-turn must never be fatal: these are the injectable defaults behind the
 * opt-in `retry` flag, sized so a throttled read settles well inside a client's own reconnect
 * window rather than compounding it.
 */
export const DEFAULT_RETRY_MAX_ATTEMPTS = 4
export const DEFAULT_RETRY_BASE_DELAY_MS = 500
export const DEFAULT_RETRY_CEILING_DELAY_MS = 8_000
/**
 * A wedged control plane holds a connection open with no bytes until a proxy gives up at ~60s;
 * that hang must never be what a boot or a turn waits on. Every attempt gets its own abort so a
 * stall fails fast and the retry path (or the caller) takes over instead of blocking on the proxy.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000

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
  /** Per-attempt abort. Defaults to DEFAULT_REQUEST_TIMEOUT_MS; pass null to wait indefinitely. */
  timeoutMs?: number | null | undefined
}): Promise<unknown> => {
  const sleep = args.sleep ?? defaultSleep
  const randomFn = args.randomFn ?? Math.random
  const retry = args.retry === true
  const maxAttempts = args.maxAttempts ?? DEFAULT_RETRY_MAX_ATTEMPTS
  const baseDelayMs = args.baseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS
  const ceilingDelayMs = args.ceilingDelayMs ?? DEFAULT_RETRY_CEILING_DELAY_MS
  const timeoutMs = args.timeoutMs === undefined ? DEFAULT_REQUEST_TIMEOUT_MS : args.timeoutMs

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
        ...(timeoutMs === null ? {} : { signal: AbortSignal.timeout(timeoutMs) }),
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

/**
 * `cloudRequest`'s binary sibling: no JSON encoding on the way out, no JSON parsing on the way in.
 * The context archive and memory archive routes trade raw gzip bytes, and a 429 or a non-2xx still
 * reads its detail from a JSON body when the API sent one.
 */
export const cloudRawRequest = async (args: {
  url: string
  token: string
  clientVersion: string
  fetchFn: typeof fetch
  method: string
  path: string
  body?: Uint8Array | undefined
  contentType?: string | undefined
  accept?: string | undefined
  allowMissing?: boolean
  sleep?: ((ms: number) => Promise<void>) | undefined
  /** Per-attempt abort. Defaults to DEFAULT_REQUEST_TIMEOUT_MS; pass null to wait indefinitely. */
  timeoutMs?: number | null | undefined
}): Promise<Uint8Array | null> => {
  const sleep = args.sleep ?? defaultSleep
  const timeoutMs = args.timeoutMs === undefined ? DEFAULT_REQUEST_TIMEOUT_MS : args.timeoutMs

  for (let attempt = 0; ; attempt += 1) {
    let response: Response
    try {
      response = await args.fetchFn(`${args.url}${args.path}`, {
        method: args.method,
        headers: {
          authorization: `Bearer ${args.token}`,
          'atlas-client-version': args.clientVersion,
          ...(args.contentType === undefined ? {} : { 'content-type': args.contentType }),
          ...(args.accept === undefined ? {} : { accept: args.accept }),
        },
        ...(args.body === undefined ? {} : { body: args.body as NonNullable<RequestInit['body']> }),
        ...(timeoutMs === null ? {} : { signal: AbortSignal.timeout(timeoutMs) }),
      })
    } catch (cause) {
      throw new CloudError({
        status: 0,
        message: `The Atlas Cloud API at ${args.url} could not be reached: ${cause instanceof Error ? cause.message : String(cause)}.`,
      })
    }

    if (isRetryableStatus(response.status) && attempt < DEFAULT_RETRY_MAX_ATTEMPTS - 1) {
      const afterMs = retryAfterMs(response)
      await sleep(
        afterMs === undefined
          ? backoffDelayMs({
              attempt,
              baseDelayMs: DEFAULT_RETRY_BASE_DELAY_MS,
              ceilingDelayMs: DEFAULT_RETRY_CEILING_DELAY_MS,
              randomFn: Math.random,
            })
          : Math.min(afterMs, DEFAULT_RETRY_CEILING_DELAY_MS),
      )
      continue
    }

    if (response.status === 404 && args.allowMissing === true) return null

    if (!response.ok) {
      const detail = detailFrom(safeJson(await response.text()))
      throw new CloudError({
        status: response.status,
        message: `The Atlas Cloud API answered ${args.method} ${args.path} with ${response.status}${detail === undefined ? '' : `: ${detail}`}.`,
      })
    }

    return new Uint8Array(await response.arrayBuffer())
  }
}

/**
 * The `{url, token, clientVersion, fetchFn}` a client holds to reach the control plane, factored
 * once so `SandboxClient` and `UserContextClient` do not each re-spell it at every call site that
 * needs a raw (binary) request alongside their JSON ones.
 */
export class CloudTransport {
  private readonly url: string
  private readonly token: string
  private readonly clientVersion: string
  private readonly fetchFn: typeof fetch

  constructor(args: {
    url: string
    token: string
    clientVersion?: string | undefined
    fetchFn?: typeof fetch | undefined
  }) {
    this.url = args.url.replace(/\/+$/, '')
    this.token = args.token
    this.clientVersion = args.clientVersion ?? 'dev'
    this.fetchFn = args.fetchFn ?? fetch
  }

  request(args: {
    method: string
    path: string
    body?: unknown
    allowMissing?: boolean
    retry?: boolean
  }): Promise<unknown> {
    return cloudRequest({
      url: this.url,
      token: this.token,
      clientVersion: this.clientVersion,
      fetchFn: this.fetchFn,
      method: args.method,
      path: args.path,
      ...(args.body === undefined ? {} : { body: args.body }),
      ...(args.allowMissing === undefined ? {} : { allowMissing: args.allowMissing }),
      ...(args.retry === undefined ? {} : { retry: args.retry }),
    })
  }

  rawRequest(args: {
    method: string
    path: string
    body?: Uint8Array | undefined
    contentType?: string | undefined
    accept?: string | undefined
    allowMissing?: boolean
  }): Promise<Uint8Array | null> {
    return cloudRawRequest({
      url: this.url,
      token: this.token,
      clientVersion: this.clientVersion,
      fetchFn: this.fetchFn,
      method: args.method,
      path: args.path,
      ...(args.body === undefined ? {} : { body: args.body }),
      ...(args.contentType === undefined ? {} : { contentType: args.contentType }),
      ...(args.accept === undefined ? {} : { accept: args.accept }),
      ...(args.allowMissing === undefined ? {} : { allowMissing: args.allowMissing }),
    })
  }
}

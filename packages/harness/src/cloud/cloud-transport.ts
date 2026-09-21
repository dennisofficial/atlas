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

const MAX_THROTTLE_RETRIES = 3

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const throttleDelayMs = (args: { response: Response; attempt: number }): number => {
  const retryAfter = args.response.headers.get('retry-after')
  if (retryAfter !== null) {
    const seconds = Number.parseFloat(retryAfter)
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30_000)
  }
  return 1000 * 2 ** args.attempt
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
  sleep?: ((ms: number) => Promise<void>) | undefined
}): Promise<unknown> => {
  const sleep = args.sleep ?? defaultSleep

  for (let attempt = 0; ; attempt += 1) {
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
      throw new CloudError({
        status: 0,
        message: `The Atlas Cloud API at ${args.url} could not be reached: ${cause instanceof Error ? cause.message : String(cause)}.`,
      })
    }

    const text = await response.text()

    if (response.status === 429 && attempt < MAX_THROTTLE_RETRIES) {
      await sleep(throttleDelayMs({ response, attempt }))
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
}): Promise<Uint8Array | null> => {
  const sleep = args.sleep ?? defaultSleep

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
      })
    } catch (cause) {
      throw new CloudError({
        status: 0,
        message: `The Atlas Cloud API at ${args.url} could not be reached: ${cause instanceof Error ? cause.message : String(cause)}.`,
      })
    }

    if (response.status === 429 && attempt < MAX_THROTTLE_RETRIES) {
      await sleep(throttleDelayMs({ response, attempt }))
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

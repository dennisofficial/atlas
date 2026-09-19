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

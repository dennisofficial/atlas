import { type ApiClient, createApiClient, detailsOf, httpStatusOf } from '@dltech/atlas-api-router'

import {
  backoffDelayMs,
  defaultSleep,
  isRetryableStatus,
  noteGiveUp,
  noteRetry,
  retryAfterMs,
  type TransportRetryLog,
} from './cloud-retry'
import {
  CloudError,
  DEFAULT_RETRY_BASE_DELAY_MS,
  DEFAULT_RETRY_CEILING_DELAY_MS,
  DEFAULT_RETRY_MAX_ATTEMPTS,
  DEFAULT_REQUEST_TIMEOUT_MS,
} from './cloud-transport'

const TRPC_INTERNAL_ERROR_CODE = -32603

type FetchInput = Parameters<typeof fetch>[0]

export type RetryingFetchArgs = {
  fetchFn: typeof fetch
  log?: TransportRetryLog | undefined
  sleep?: ((ms: number) => Promise<void>) | undefined
  randomFn?: (() => number) | undefined
  timeoutMs?: number | null | undefined
}

const pathOf = (input: FetchInput): string => {
  const url = input instanceof Request ? input.url : String(input)
  try {
    return new URL(url, 'http://placeholder.invalid').pathname
  } catch {
    return url
  }
}

const parsedOrUndefined = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

const isErrorEnvelope = (body: unknown): boolean =>
  typeof body === 'object' &&
  body !== null &&
  typeof Reflect.get(body, 'error') === 'object' &&
  Reflect.get(body, 'error') !== null

const withTrpcErrorBody = async (response: Response): Promise<Response> => {
  if (response.ok) return response
  const text = await response.text()
  if (isErrorEnvelope(parsedOrUndefined(text))) {
    return new Response(text, { status: response.status, headers: response.headers })
  }
  return Response.json(
    {
      error: {
        message: `Atlas Cloud answered ${response.status}`,
        code: TRPC_INTERNAL_ERROR_CODE,
        data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: response.status },
      },
    },
    { status: response.status },
  )
}

const attemptSignal = (args: {
  callerSignal: AbortSignal | null | undefined
  timeoutMs: number | null
}): AbortSignal | undefined => {
  const caller = args.callerSignal ?? undefined
  if (args.timeoutMs === null) return caller
  const timeout = AbortSignal.timeout(args.timeoutMs)
  return caller === undefined ? timeout : AbortSignal.any([caller, timeout])
}

export const createRetryingFetch = (args: RetryingFetchArgs): typeof fetch => {
  const sleep = args.sleep ?? defaultSleep
  const randomFn = args.randomFn ?? Math.random
  const timeoutMs = args.timeoutMs === undefined ? DEFAULT_REQUEST_TIMEOUT_MS : args.timeoutMs

  const run = async (input: FetchInput, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? 'GET'
    const path = pathOf(input)
    const retry = method === 'GET'

    for (let attempt = 0; ; attempt += 1) {
      const attemptsLeft =
        retry && attempt < DEFAULT_RETRY_MAX_ATTEMPTS - 1 && init?.signal?.aborted !== true
      const signal = attemptSignal({ callerSignal: init?.signal, timeoutMs })

      let response: Response
      try {
        response = await args.fetchFn(input, {
          ...init,
          ...(signal === undefined ? {} : { signal }),
        })
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : String(cause)
        if (!attemptsLeft) {
          noteGiveUp({ log: args.log, method, path, cause: `network: ${reason}`, attempt })
          throw cause
        }
        const delayMs = backoffDelayMs({
          attempt,
          baseDelayMs: DEFAULT_RETRY_BASE_DELAY_MS,
          ceilingDelayMs: DEFAULT_RETRY_CEILING_DELAY_MS,
          randomFn,
        })
        noteRetry({ log: args.log, method, path, cause: `network: ${reason}`, attempt, delayMs })
        await sleep(delayMs)
        continue
      }

      if (!isRetryableStatus(response.status)) return withTrpcErrorBody(response)

      const cause = `status ${response.status}`
      if (!attemptsLeft) {
        noteGiveUp({ log: args.log, method, path, cause, attempt })
        return withTrpcErrorBody(response)
      }
      const afterMs = retryAfterMs(response)
      const delayMs =
        afterMs === undefined
          ? backoffDelayMs({
              attempt,
              baseDelayMs: DEFAULT_RETRY_BASE_DELAY_MS,
              ceilingDelayMs: DEFAULT_RETRY_CEILING_DELAY_MS,
              randomFn,
            })
          : Math.min(afterMs, DEFAULT_RETRY_CEILING_DELAY_MS)
      noteRetry({ log: args.log, method, path, cause, attempt, delayMs })
      await sleep(delayMs)
    }
  }

  return Object.assign(run, { preconnect: fetch.preconnect })
}

export const createHarnessApiClient = (args: {
  url: string
  token: string
  clientVersion: string
  fetchFn: typeof fetch
  log?: TransportRetryLog | undefined
  sleep?: ((ms: number) => Promise<void>) | undefined
  randomFn?: (() => number) | undefined
  timeoutMs?: number | null | undefined
}): ApiClient =>
  createApiClient({
    baseUrl: args.url,
    token: args.token,
    clientVersion: args.clientVersion,
    fetchFn: createRetryingFetch({
      fetchFn: args.fetchFn,
      log: args.log,
      sleep: args.sleep,
      randomFn: args.randomFn,
      timeoutMs: args.timeoutMs,
    }),
  })

const detailCode = (failure: unknown): string | undefined => {
  const code = detailsOf(failure)?.code
  return typeof code === 'string' && code.length > 0 ? code : undefined
}

export const toCloudError = (failure: unknown): CloudError => {
  if (failure instanceof CloudError) return failure
  const message = failure instanceof Error ? failure.message : String(failure)
  const status = httpStatusOf(failure)
  if (status === undefined) {
    return new CloudError({
      status: 0,
      message: `The Atlas Cloud API could not be reached: ${message}.`,
    })
  }
  return new CloudError({
    status,
    message: `The Atlas Cloud API answered ${status}: ${message}.`,
    code: detailCode(failure),
  })
}

export function cloudCall<T>(
  promise: Promise<T>,
  options: { allowMissing: true },
): Promise<T | undefined>
export function cloudCall<T>(promise: Promise<T>, options?: { allowMissing?: false }): Promise<T>
export async function cloudCall<T>(
  promise: Promise<T>,
  options?: { allowMissing?: boolean },
): Promise<T | undefined> {
  try {
    return await promise
  } catch (failure) {
    if (options?.allowMissing === true && httpStatusOf(failure) === 404) return undefined
    throw toCloudError(failure)
  }
}

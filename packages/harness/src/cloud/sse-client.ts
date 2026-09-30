import { fetchEventSource } from '@microsoft/fetch-event-source'

import { CloudError } from './cloud-transport'

// @microsoft/fetch-event-source is browser-first: its dispose path touches `document` and
// `window` even with `openWhenHidden: true`, and it defaults to `window.fetch`. Under Bun none
// of those exist, so install a no-op stub before the first call. Tracked upstream as a Bun/Deno
// incompatibility; a server-side EventSource polyfill would pull in far more.
const installBrowserStubs = (): void => {
  const globalScope = globalThis as { document?: unknown; window?: unknown }
  if (globalScope.document === undefined) {
    globalScope.document = {
      hidden: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }
  }
  if (globalScope.window === undefined) {
    globalScope.window = { fetch, setTimeout, clearTimeout }
  }
}
installBrowserStubs()

export type SseFrame = {
  id: string | undefined
  event: string
  data: string
}

export type SseHandlers = {
  onFrame: (frame: SseFrame) => void
  onDrop?: (() => void) | undefined
  onOpen?: (() => void | Promise<void>) | undefined
}

export class SseRefused extends Error {
  constructor(readonly status: number) {
    super(`the pull request stream answered ${status}`)
    this.name = 'SseRefused'
  }
}

const RETRY_FLOOR_MS = 1_000
const RETRY_CAP_MS = 30_000
const SILENCE_TIMEOUT_MS = 75_000
const EVENT_STREAM_CONTENT_TYPE = 'text/event-stream'

const authorizationOf = (token: string): Record<string, string> => ({
  authorization: `Bearer ${token}`,
})

class SseSilenceTimeout extends Error {
  constructor() {
    super('the pull request stream went silent')
    this.name = 'SseSilenceTimeout'
  }
}

type Attempt = {
  controller: AbortController
  releaseAttempt: () => void
}

const untilAttemptAborts = async (args: { work: Promise<void>; signal: AbortSignal }): Promise<void> => {
  let handleAbort: () => void = () => {}
  const aborted = new Promise<never>((_, reject) => {
    handleAbort = () => reject(new SseSilenceTimeout())
    args.signal.addEventListener('abort', handleAbort, { once: true })
    if (args.signal.aborted) handleAbort()
  })
  try {
    await Promise.race([args.work, aborted])
  } finally {
    args.signal.removeEventListener('abort', handleAbort)
  }
}

/**
 * One SSE connection's full life. Retries drops with a capped backoff; cancels and reconnects a
 * connection silent for `silenceTimeoutMs` (75s default) the same way. Resolves on abort; rejects
 * with `SseRefused` on 401/403. `onOpen` is awaited before frames flow but is cut off by the same
 * silence timeout, so a hung catch-up reconnects while the stale work settles.
 */
export async function runSseStream(args: {
  url: string
  token: string
  clientVersion: string
  signal: AbortSignal
  handlers: SseHandlers
  silenceTimeoutMs?: number | undefined
  randomFn?: (() => number) | undefined
}): Promise<void> {
  if (args.signal.aborted) return

  const silenceTimeoutMs = args.silenceTimeoutMs ?? SILENCE_TIMEOUT_MS
  const randomFn = args.randomFn ?? Math.random
  let consecutiveDrops = 0
  let watchdog: ReturnType<typeof setTimeout> | null = null
  let attempt: Attempt | null = null

  const clearWatchdog = (): void => {
    if (watchdog === null) return
    clearTimeout(watchdog)
    watchdog = null
  }

  const armWatchdog = (): void => {
    if (args.signal.aborted) return
    clearWatchdog()
    const armed = attempt
    watchdog = setTimeout(() => {
      watchdog = null
      if (attempt === armed) armed?.controller.abort()
    }, silenceTimeoutMs)
    watchdog.unref?.()
  }

  // fetch-event-source keeps its per-attempt AbortController private and never cancels the
  // request itself when `onopen` throws, so every failed attempt — refusal, catch-up rejection,
  // watchdog trip — is torn down in `onerror`, otherwise the abandoned stream stays open and its
  // body tap keeps rearming the watchdog through the backoff wait. The tap counts any arriving
  // bytes — event or `:comment` heartbeat — as a sign of life, because the library never surfaces
  // comment frames to `onmessage`.
  const watchedFetch: typeof fetch = Object.assign(
    async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const controller = new AbortController()
      const attemptSignal = init?.signal ?? undefined
      if (attemptSignal?.aborted === true) controller.abort()
      const forwardAbort = (): void => controller.abort()
      attemptSignal?.addEventListener('abort', forwardAbort)

      const self: Attempt = {
        controller,
        releaseAttempt: () => {
          attemptSignal?.removeEventListener('abort', forwardAbort)
          controller.abort()
          if (attempt === self) attempt = null
        },
      }
      attempt = self

      const response = await fetch(input, { ...init, signal: controller.signal })
      if (response.body === null) return response
      const signOfLife = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, streamController) {
          if (attempt === self) armWatchdog()
          streamController.enqueue(chunk)
        },
      })
      return new Response(response.body.pipeThrough(signOfLife), response)
    },
    { preconnect: fetch.preconnect },
  )

  const releaseActiveAttempt = (): void => {
    attempt?.releaseAttempt()
  }

  try {
    await fetchEventSource(args.url, {
      fetch: watchedFetch,
      signal: args.signal,
      headers: {
        ...authorizationOf(args.token),
        'atlas-client-version': args.clientVersion,
      },
      openWhenHidden: true,
      async onopen(response) {
        if (response.status === 401 || response.status === 403) {
          throw new SseRefused(response.status)
        }
        if (!response.ok) {
          throw new CloudError({
            status: response.status,
            message: `The Atlas Cloud API answered the pull request stream with ${response.status}.`,
          })
        }
        // A custom onopen replaces the library's content-type check, and a proxy in front of the
        // API can answer 200 with a JSON or HTML error page — without this the dead stream would
        // read as a clean connect until the silence watchdog noticed.
        const contentType = response.headers.get('content-type')
        if (contentType?.startsWith(EVENT_STREAM_CONTENT_TYPE) !== true) {
          throw new CloudError({
            status: response.status,
            message: `The Atlas Cloud API answered the pull request stream with ${contentType ?? 'no content-type'}, not ${EVENT_STREAM_CONTENT_TYPE}.`,
          })
        }
        const opened = attempt
        armWatchdog()
        const catchUp = args.handlers.onOpen?.()
        if (catchUp !== undefined && opened !== null) {
          await untilAttemptAborts({ work: catchUp, signal: opened.controller.signal })
        }
        consecutiveDrops = 0
      },
      onmessage(message) {
        if (message.event === '' || message.data === '') return

        args.handlers.onFrame({
          id: message.id === '' ? undefined : message.id,
          event: message.event,
          data: message.data,
        })
      },
      onclose() {
        clearWatchdog()
        throw new Error('the pull request stream ended')
      },
      onerror(failure) {
        clearWatchdog()
        releaseActiveAttempt()
        if (failure instanceof SseRefused) throw failure

        consecutiveDrops += 1
        args.handlers.onDrop?.()
        return Math.min(RETRY_CAP_MS, RETRY_FLOOR_MS * 2 ** (consecutiveDrops - 1)) * randomFn()
      },
    })
  } finally {
    clearWatchdog()
    releaseActiveAttempt()
  }
}

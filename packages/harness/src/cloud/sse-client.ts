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
  /** Fired when the stream drops and will be retried: the reader should mark itself stale. */
  onDrop?: (() => void) | undefined
}

/**
 * The 401/403 the stream can meet means the cloud session is dead, not the stream: reconnecting
 * would spin forever, so the promise settles instead and the caller surfaces re-sign-in. A
 * refusal the library would otherwise retry is converted by throwing out of `onopen`.
 */
export class SseRefused extends Error {
  constructor(readonly status: number) {
    super(`the pull request stream answered ${status}`)
    this.name = 'SseRefused'
  }
}

const RETRY_FLOOR_MS = 1_000
const RETRY_CAP_MS = 30_000

const authorizationOf = (token: string): Record<string, string> => ({
  authorization: `Bearer ${token}`,
})

/**
 * One SSE connection's full life: connect, deliver frames, and on a drop retry with a capped
 * backoff until `signal` fires. Resolves on abort; rejects with `SseRefused` on a 401/403 so
 * the caller stops asking rather than retrying a session that cannot recover on its own.
 */
export async function runSseStream(args: {
  url: string
  token: string
  clientVersion: string
  signal: AbortSignal
  handlers: SseHandlers
  sleep?: ((ms: number) => Promise<void>) | undefined
  randomFn?: (() => number) | undefined
}): Promise<void> {
  const randomFn = args.randomFn ?? Math.random
  let consecutiveDrops = 0

  // window.fetch is the library default; Bun has no window, so the runtime fetch is explicit.
  await fetchEventSource(args.url, {
    fetch,
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
      args.handlers.onDrop?.()
      throw new Error('the pull request stream ended')
    },
    onerror(failure) {
      if (failure instanceof SseRefused) throw failure

      consecutiveDrops += 1
      args.handlers.onDrop?.()
      return Math.min(RETRY_CAP_MS, RETRY_FLOOR_MS * 2 ** (consecutiveDrops - 1)) * randomFn()
    },
  })
}

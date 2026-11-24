// The codex backend answers a turn's requests on one machine only when the client replays the
// `x-codex-turn-state` token that the turn's first response carried. Codex keeps the token per
// turn, sends it on every later same-turn request and clears it when the turn or the auth owner
// changes: https://github.com/openai/codex/blob/main/codex-rs/core/src/client.rs and
// https://github.com/openai/codex/blob/main/codex-rs/codex-api/src/sse/responses.rs
export const CODEX_TURN_STATE_HEADER = 'x-codex-turn-state'

export const DEFAULT_TURN_STATE_LIMIT = 2000
export const DEFAULT_TURN_STATE_TTL_MS = 60 * 60 * 1000

type TurnState = { value: string; observedAt: number }

export type CodexTurnStateStore = {
  read: (args: { key: string }) => string | undefined
  write: (args: { key: string; observedAt?: number; value: string }) => void
  clear: () => void
  size: () => number
}

export function createCodexTurnStateStore({
  limit = DEFAULT_TURN_STATE_LIMIT,
  ttlMs = DEFAULT_TURN_STATE_TTL_MS,
  now = Date.now,
}: {
  limit?: number
  ttlMs?: number
  now?: () => number
} = {}): CodexTurnStateStore {
  const states = new Map<string, TurnState>()

  const expired = (state: TurnState, at: number): boolean => at - state.observedAt > ttlMs

  return {
    read: ({ key }) => {
      const state = states.get(key)
      if (state === undefined) return undefined
      if (!expired(state, now())) {
        states.delete(key)
        states.set(key, state)
        return state.value
      }
      states.delete(key)
      return undefined
    },
    write: ({ key, value, observedAt = now() }) => {
      states.delete(key)
      states.set(key, { value, observedAt })
      while (states.size > limit) {
        const oldest = states.keys().next()
        if (oldest.done === true) return
        states.delete(oldest.value)
      }
    },
    clear: () => states.clear(),
    size: () => states.size,
  }
}

const cacheKeyIn = (body: unknown): string | undefined => {
  if (typeof body !== 'string') return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const key = (parsed as Record<string, unknown>).prompt_cache_key
  return typeof key === 'string' && key !== '' ? key : undefined
}

export function promptCacheKeyOf(body: unknown): string | undefined {
  return cacheKeyIn(body)
}

export type CodexFetch = (
  input: string | URL | Request,
  init?: RequestInit | undefined,
) => Promise<Response>

export function withCodexTurnState({
  fetch,
  store,
}: {
  fetch: CodexFetch
  store: CodexTurnStateStore
}): CodexFetch {
  return async (input, init) => {
    const key = promptCacheKeyOf(init?.body)
    const known = key === undefined ? undefined : store.read({ key })
    const headers = new Headers(init?.headers)
    if (known !== undefined) headers.set(CODEX_TURN_STATE_HEADER, known)

    const response = await fetch(input, init === undefined ? init : { ...init, headers })
    const received = response.headers.get(CODEX_TURN_STATE_HEADER)
    if (key !== undefined && received !== null && received !== '')
      store.write({ key, value: received })
    return response
  }
}

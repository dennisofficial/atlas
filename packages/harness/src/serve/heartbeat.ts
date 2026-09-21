import type { ThreadId } from '@dltech/atlas-core'

import { cloudRequest } from '../cloud/cloud-transport'

export const HEARTBEAT_INTERVAL_MS = 20_000

/**
 * The sandbox's TTL is extended by work, never by attention: a socket that is merely open must let
 * the sandbox park. Vercel's own interactive shell extends for as long as the socket lives; that is
 * deliberately not copied.
 */
export type Heartbeat = {
  beat: () => void
  turnStarted: () => void
  turnEnded: () => void
  stop: () => void
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'the heartbeat failed for a reason it did not name'

export function createHeartbeat(args: {
  controlPlaneUrl: string
  threadId: ThreadId
  token: string
  fetchFn: typeof fetch
  intervalMs?: number | undefined
  onFailure?: ((reason: string) => void) | undefined
  sleep?: ((ms: number) => Promise<void>) | undefined
}): Heartbeat {
  const url = args.controlPlaneUrl.replace(/\/+$/, '')
  const path = `/v1/sandboxes/${args.threadId}/heartbeat`
  let timer: ReturnType<typeof setInterval> | null = null
  let holds = 0

  /** An idempotent lastActivity bump — a throttled or reset beat is worth retrying, not skipping. */
  const beat = (): void => {
    void cloudRequest({
      url,
      token: args.token,
      clientVersion: 'dev',
      fetchFn: args.fetchFn,
      method: 'POST',
      path,
      retry: true,
      ...(args.sleep === undefined ? {} : { sleep: args.sleep }),
    }).catch((cause: unknown) => args.onFailure?.(messageOf(cause)))
  }

  const stop = (): void => {
    holds = 0
    if (timer === null) return
    clearInterval(timer)
    timer = null
  }

  return {
    beat,

    turnStarted() {
      holds += 1
      beat()
      if (timer !== null) return
      timer = setInterval(beat, args.intervalMs ?? HEARTBEAT_INTERVAL_MS)
    },

    turnEnded() {
      holds = Math.max(0, holds - 1)
      if (holds > 0) return
      if (timer === null) return
      clearInterval(timer)
      timer = null
    },

    stop,
  }
}

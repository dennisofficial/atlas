import { EGithubWakeFrame } from '@dltech/atlas-wire'

import type { CloudSession } from './cloud-session'
import { createStreamClient } from './sse-stream-client'

const RETRY_CAP_MS = 30_000

const pause = (args: { ms: number; signal: AbortSignal }): Promise<void> =>
  new Promise<void>((resolve) => {
    const settle = (): void => {
      clearTimeout(timer)
      args.signal.removeEventListener('abort', settle)
      resolve()
    }
    const timer = setTimeout(settle, args.ms)
    args.signal.addEventListener('abort', settle, { once: true })
  })

const attemptOnce = (args: {
  session: CloudSession
  clientVersion: string
  signal: AbortSignal
  onWake: (wake: { threadId: string }) => void
  onFrame: () => void
}): Promise<void> =>
  new Promise<void>((resolve) => {
    const client = createStreamClient({
      baseUrl: args.session.url,
      token: args.session.token,
      clientVersion: args.clientVersion,
      onBytes: () => undefined,
      onStatus: () => undefined,
    })
    let done = false
    const finish = (): void => {
      if (done) return
      done = true
      args.signal.removeEventListener('abort', finish)
      subscription.unsubscribe()
      resolve()
    }
    const subscription = client.githubPrs.wakes.subscribe(undefined, {
      onData: (frame) => {
        args.onFrame()
        if (frame.type !== EGithubWakeFrame.Wake) return
        try {
          args.onWake({ threadId: frame.threadId })
        } catch {
          return
        }
      },
      onError: finish,
      onComplete: finish,
      onStopped: finish,
      onConnectionStateChange: (state) => {
        if (state.state === 'connecting' && state.error !== null) finish()
      },
    })
    args.signal.addEventListener('abort', finish, { once: true })
    if (args.signal.aborted) finish()
  })

/** Holds the signed-in user's wake stream open until `signal` aborts, reconnecting with backoff. */
export async function watchThreadWakes(args: {
  session: CloudSession
  clientVersion: string
  signal: AbortSignal
  onWake: (wake: { threadId: string }) => void
  retryFloorMs?: number
}): Promise<void> {
  const floorMs = args.retryFloorMs ?? 1_000
  let drops = 0
  while (!args.signal.aborted) {
    await attemptOnce({ ...args, onFrame: () => (drops = 0) })
    if (args.signal.aborted) return
    drops += 1
    await pause({ ms: Math.min(RETRY_CAP_MS, floorMs * 2 ** (drops - 1)), signal: args.signal })
  }
}

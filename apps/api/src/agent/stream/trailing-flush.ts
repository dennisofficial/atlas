import type { OutgoingFrame } from './subscription-port'

const FLUSH_FRAME: OutgoingFrame = { type: 'pong' }

export type TrailingFlush = {
  afterSend(): void
}

// Vercel's /v1 rewrite holds the last bytes of an SSE burst until the next write (measured: the
// ~20 s tRPC ping), so every burst ends with a frame of its own to release the one before it.
export const createTrailingFlush = (args: {
  send: (frame: OutgoingFrame) => void
  schedule?: (run: () => void) => void
}): TrailingFlush => {
  const schedule = args.schedule ?? ((run: () => void) => void queueMicrotask(run))
  let pending = false
  return {
    afterSend: () => {
      if (pending) return
      pending = true
      schedule(() => {
        pending = false
        args.send(FLUSH_FRAME)
      })
    },
  }
}

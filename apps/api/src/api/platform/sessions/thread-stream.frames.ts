import type { ThreadStreamFrame } from '@dltech/atlas-wire'

export type ThreadFrameSink = { push: (frame: ThreadStreamFrame) => void; close: () => void }

export async function* threadStreamFrames(args: {
  signal: AbortSignal | undefined
  attach: (sink: ThreadFrameSink) => () => void
}): AsyncGenerator<ThreadStreamFrame> {
  const queue: ThreadStreamFrame[] = []
  let closed = false
  let wake: (() => void) | null = null
  const notify = (): void => {
    const pending = wake
    wake = null
    pending?.()
  }
  const close = (): void => {
    closed = true
    notify()
  }
  const detach = args.attach({
    push: (frame) => {
      if (closed) return
      queue.push(frame)
      notify()
    },
    close,
  })
  args.signal?.addEventListener('abort', close, { once: true })
  if (args.signal?.aborted === true) close()
  try {
    while (true) {
      const next = queue.shift()
      if (next !== undefined) {
        yield next
        continue
      }
      if (closed) return
      await new Promise<void>((resolve) => {
        wake = resolve
      })
    }
  } finally {
    args.signal?.removeEventListener('abort', close)
    detach()
  }
}

const TICK_MS = 10

export type ShapedDirection = {
  push(chunk: Buffer): void
  close(): void
}

type Queued = { dueAt: number; chunk: Buffer }

export const shapedDirection = (args: {
  write: (chunk: Buffer) => void
  latencyMs: number
  bytesPerSecond: number | undefined
  paused: () => boolean
  countBytes: (bytes: number) => void
}): ShapedDirection => {
  const queue: Queued[] = []
  const unshaped = args.bytesPerSecond === undefined && args.latencyMs === 0
  const perTick = args.bytesPerSecond === undefined ? 0 : (args.bytesPerSecond * TICK_MS) / 1000
  let budget = perTick
  let alive = true

  const send = (chunk: Buffer): void => {
    args.write(chunk)
    args.countBytes(chunk.length)
  }

  function flush(): void {
    if (!alive || args.paused()) return
    const now = Date.now()
    if (args.bytesPerSecond !== undefined) {
      budget = Math.min(budget + perTick, Math.max(perTick, args.bytesPerSecond))
    }
    while (queue.length > 0) {
      const head = queue[0]
      if (head === undefined || head.dueAt > now) return
      if (args.bytesPerSecond === undefined) {
        queue.shift()
        send(head.chunk)
        continue
      }
      const take = Math.min(head.chunk.length, Math.floor(budget))
      if (take <= 0) return
      if (take === head.chunk.length) queue.shift()
      else queue[0] = { dueAt: head.dueAt, chunk: head.chunk.subarray(take) }
      budget -= take
      send(head.chunk.subarray(0, take))
    }
  }

  const timer = unshaped ? undefined : setInterval(flush, TICK_MS)

  return {
    push: (chunk) => {
      if (!alive) return
      if (unshaped) {
        send(chunk)
        return
      }
      queue.push({ dueAt: Date.now() + args.latencyMs, chunk })
    },
    close: () => {
      if (!alive) return
      alive = false
      if (timer !== undefined) clearInterval(timer)
      queue.length = 0
    },
  }
}

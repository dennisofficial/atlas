import type { DaemonFrame, HostFrame } from '../frames'

export type DaemonSession = {
  send(frame: HostFrame): void
  next(): Promise<DaemonFrame>
  until(predicate: (frame: DaemonFrame) => boolean): Promise<DaemonFrame>
  frames(): readonly DaemonFrame[]
  close(): void
  closed: Promise<{ code: number; reason: string }>
}

export class FrameQueue {
  private readonly frames: DaemonFrame[] = []
  private readonly waiters: ((frame: DaemonFrame) => boolean)[] = []

  push(frame: DaemonFrame): void {
    this.frames.push(frame)
    for (let index = this.waiters.length - 1; index >= 0; index--) {
      const waiter = this.waiters[index]
      if (waiter?.(frame)) this.waiters.splice(index, 1)
    }
  }

  next(): Promise<DaemonFrame> {
    const frame = this.frames.shift()
    if (frame !== undefined) return Promise.resolve(frame)
    return new Promise<DaemonFrame>((resolve) => {
      this.waiters.push((pushed) => {
        resolve(pushed)
        return true
      })
    })
  }

  until(predicate: (frame: DaemonFrame) => boolean): Promise<DaemonFrame> {
    const existing = this.frames.find(predicate)
    if (existing !== undefined) return Promise.resolve(existing)
    return new Promise<DaemonFrame>((resolve) => {
      this.waiters.push((pushed) => {
        if (!predicate(pushed)) return false
        resolve(pushed)
        return true
      })
    })
  }

  all(): readonly DaemonFrame[] {
    return this.frames
  }
}

export const sessionOverQueue = (args: {
  queue: FrameQueue
  send(frame: HostFrame): void
  close(): void
  closed: Promise<{ code: number; reason: string }>
}): DaemonSession => ({
  send: args.send,
  next: () => args.queue.next(),
  until: (predicate) => args.queue.until(predicate),
  frames: () => args.queue.all(),
  close: args.close,
  closed: args.closed,
})

import { daemonFrameSchema, type DaemonFrame, type HostFrame } from '../frames'

export type WaitOptions = { timeoutMs?: number | undefined; label?: string | undefined }

export type DaemonSession = {
  send(frame: HostFrame): void
  sendRaw(text: string): void
  until(predicate: (frame: DaemonFrame) => boolean, options?: WaitOptions): Promise<DaemonFrame>
  frames(): readonly DaemonFrame[]
  close(): void
  closed: Promise<{ code: number; reason: string }>
}

const DEFAULT_WAIT_MS = 10_000

type Waiter = {
  predicate(frame: DaemonFrame): boolean
  resolve(frame: DaemonFrame): void
  reject(error: Error): void
}

export class FrameQueue {
  private readonly history: DaemonFrame[] = []
  private readonly pending: DaemonFrame[] = []
  private readonly waiters = new Set<Waiter>()
  private violation: Error | null = null

  pushText(text: string): void {
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      this.fail(new Error(`daemon sent invalid json: ${text.slice(0, 200)}`))
      return
    }
    const parsed = daemonFrameSchema.safeParse(json)
    if (!parsed.success) {
      this.fail(
        new Error(`daemon sent an invalid frame ${text.slice(0, 200)}: ${parsed.error.message}`),
      )
      return
    }
    this.push(parsed.data)
  }

  until(predicate: (frame: DaemonFrame) => boolean, options?: WaitOptions): Promise<DaemonFrame> {
    if (this.violation !== null) return Promise.reject(this.violation)
    const index = this.pending.findIndex(predicate)
    if (index >= 0) {
      const [frame] = this.pending.splice(index, 1)
      if (frame !== undefined) return Promise.resolve(frame)
    }
    const timeoutMs = options?.timeoutMs ?? DEFAULT_WAIT_MS
    return new Promise<DaemonFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(waiter)
        reject(new Error(`no ${options?.label ?? 'matching'} frame within ${timeoutMs} ms`))
      }, timeoutMs)
      const waiter: Waiter = {
        predicate,
        resolve: (frame) => {
          clearTimeout(timer)
          resolve(frame)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      }
      this.waiters.add(waiter)
    })
  }

  all(): readonly DaemonFrame[] {
    return this.history
  }

  private push(frame: DaemonFrame): void {
    this.history.push(frame)
    for (const waiter of this.waiters) {
      if (!waiter.predicate(frame)) continue
      this.waiters.delete(waiter)
      waiter.resolve(frame)
      return
    }
    this.pending.push(frame)
  }

  private fail(error: Error): void {
    this.violation = error
    for (const waiter of this.waiters) waiter.reject(error)
    this.waiters.clear()
  }
}

export const sessionOverQueue = (args: {
  queue: FrameQueue
  sendText(text: string): void
  close(): void
  closed: Promise<{ code: number; reason: string }>
}): DaemonSession => ({
  send: (frame) => args.sendText(JSON.stringify(frame)),
  sendRaw: args.sendText,
  until: (predicate, options) => args.queue.until(predicate, options),
  frames: () => args.queue.all(),
  close: args.close,
  closed: args.closed,
})

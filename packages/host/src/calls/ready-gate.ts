export type ReadyReply = { bootId: string; version: string }

export class ReadyGate {
  private resolveFn: ((reply: ReadyReply) => void) | null = null
  private rejectFn: ((error: Error) => void) | null = null
  promise: Promise<ReadyReply>

  constructor() {
    this.promise = this.arm()
  }

  rearm(): void {
    this.promise = this.arm()
  }

  resolve(reply: ReadyReply): void {
    this.resolveFn?.(reply)
    this.clear()
  }

  reject(error: Error): void {
    this.rejectFn?.(error)
    this.clear()
  }

  rejectSoon(error: Error): void {
    const reject = this.rejectFn
    this.clear()
    if (reject !== null) queueMicrotask(() => reject(error))
  }

  private arm(): Promise<ReadyReply> {
    const promise = new Promise<ReadyReply>((resolve, reject) => {
      this.resolveFn = resolve
      this.rejectFn = reject
    })
    promise.catch(() => undefined)
    return promise
  }

  private clear(): void {
    this.resolveFn = null
    this.rejectFn = null
  }
}

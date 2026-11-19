import type { HostTimers } from './ports'

export type HeldWait = { done: Promise<boolean>; cancel(): void }

export class HeldWaits {
  private readonly listeners = new Set<(sessionId: string) => void>()

  constructor(private readonly timers: HostTimers) {}

  notify(sessionId: string): void {
    for (const listener of [...this.listeners]) listener(sessionId)
  }

  wait(args: { sessionId: string; timeoutMs: number; signal?: AbortSignal | undefined }): HeldWait {
    let settled = false
    let finish: (held: boolean) => void = () => undefined
    const done = new Promise<boolean>((resolve) => {
      const listener = (sessionId: string): void => {
        if (sessionId === args.sessionId) finish(true)
      }
      const abort = (): void => finish(false)
      const timer = this.timers.setTimeout(() => finish(false), args.timeoutMs)
      finish = (held: boolean): void => {
        if (settled) return
        settled = true
        this.listeners.delete(listener)
        this.timers.clearTimeout(timer)
        args.signal?.removeEventListener('abort', abort)
        resolve(held)
      }
      this.listeners.add(listener)
      args.signal?.addEventListener('abort', abort)
      if (args.signal?.aborted === true) finish(false)
    })
    return { done, cancel: () => finish(false) }
  }
}

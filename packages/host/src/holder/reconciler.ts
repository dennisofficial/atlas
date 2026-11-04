import type { HostTimers } from './ports'

export const reconcileBackoffMs = (args: { failures: number }): number =>
  Math.min(250 * 2 ** Math.max(0, args.failures - 1), 5_000)

export class Reconciler {
  private running = false
  private dirty = false
  private failures = 0
  private stopped = false
  private retry: unknown

  constructor(
    private readonly args: {
      timers: HostTimers
      step(): Promise<void>
      onError?(error: unknown): void
    },
  ) {}

  request(): void {
    this.clearRetry()
    if (this.stopped) return
    if (this.running) {
      this.dirty = true
      return
    }
    void this.run()
  }

  stop(): void {
    this.stopped = true
    this.clearRetry()
  }

  private clearRetry(): void {
    if (this.retry === undefined) return
    this.args.timers.clearTimeout(this.retry)
    this.retry = undefined
  }

  private async run(): Promise<void> {
    this.running = true
    try {
      for (;;) {
        this.dirty = false
        try {
          await this.args.step()
          this.failures = 0
          this.clearRetry()
        } catch (error) {
          this.failures += 1
          this.args.onError?.(error)
          if (!this.stopped) {
            this.retry = this.args.timers.setTimeout(
              () => {
                this.retry = undefined
                this.request()
              },
              reconcileBackoffMs({ failures: this.failures }),
            )
          }
          return
        }
        if (!this.dirty) return
      }
    } finally {
      this.running = false
    }
  }
}

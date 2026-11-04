import type { HostTimers } from './ports'

export const reconcileBackoffMs = (args: { failures: number }): number =>
  Math.min(250 * 2 ** Math.max(0, args.failures - 1), 5_000)

export class Reconciler {
  private running = false
  private dirty = false
  private failures = 0

  constructor(
    private readonly args: {
      timers: HostTimers
      step(): Promise<void>
      onError?(error: unknown): void
    },
  ) {}

  request(): void {
    if (this.running) {
      this.dirty = true
      return
    }
    void this.run()
  }

  private async run(): Promise<void> {
    this.running = true
    try {
      for (;;) {
        this.dirty = false
        try {
          await this.args.step()
          this.failures = 0
        } catch (error) {
          this.failures += 1
          this.args.onError?.(error)
          this.args.timers.setTimeout(
            () => {
              this.request()
            },
            reconcileBackoffMs({ failures: this.failures }),
          )
          return
        }
        if (!this.dirty) return
      }
    } finally {
      this.running = false
    }
  }
}

import { releaseIdleAndRewake } from './held-idle'
import type { HeldSessionDeps } from './held-session-deps'
import type { SessionRuntime } from './ports'
import type { SessionRecord } from './record/record-adapter'

const RELEASE_RETRY_BASE_MS = 1_000
const RELEASE_RETRY_CAP_MS = 30_000

export class HeldRelease {
  private active = false
  private cancelled = false
  private delayMs = RELEASE_RETRY_BASE_MS
  private timer: unknown

  constructor(
    private readonly args: {
      deps: HeldSessionDeps
      onRetryDue(): void
      target(): {
        runtime: SessionRuntime | undefined
        record: SessionRecord | undefined
        epoch: number
      }
      drop(): void
    },
  ) {}

  get released(): boolean {
    return this.active
  }

  async run(end: (runtime: SessionRuntime) => Promise<void>): Promise<void> {
    const { runtime, record, epoch } = this.args.target()
    if (runtime === undefined || this.active) return
    this.active = true
    const outcome = await releaseIdleAndRewake({
      deps: this.args.deps,
      epoch,
      end: () => end(runtime),
      record,
      drop: this.args.drop,
    })
    if (outcome !== 'failed') {
      this.delayMs = RELEASE_RETRY_BASE_MS
      return
    }
    this.active = false
    if (!this.cancelled) this.scheduleRetry()
  }

  cancel(): void {
    this.cancelled = true
    if (this.timer === undefined) return
    this.args.deps.timers.clearTimeout(this.timer)
    this.timer = undefined
  }

  private scheduleRetry(): void {
    if (this.timer !== undefined) return
    const delay = this.delayMs
    this.delayMs = Math.min(delay * 2, RELEASE_RETRY_CAP_MS)
    this.timer = this.args.deps.timers.setTimeout(() => {
      this.timer = undefined
      this.args.onRetryDue()
    }, delay)
  }
}

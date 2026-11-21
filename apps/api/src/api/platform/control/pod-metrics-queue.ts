import { METRICS_RING_SIZE, type PodMetricsFrame } from '@dltech/atlas-protocol'

const CAPACITY = METRICS_RING_SIZE

export class PodMetricsQueue {
  private frames: PodMetricsFrame[] = []
  private ended = false
  private readonly waiters: (() => void)[] = []

  push(frame: PodMetricsFrame): void {
    if (this.ended) return
    this.frames.push(frame)
    if (this.frames.length > CAPACITY) this.frames.shift()
    this.wake()
  }

  end(): void {
    if (this.ended) return
    this.ended = true
    this.wake()
  }

  async next(): Promise<PodMetricsFrame | undefined> {
    while (this.frames.length === 0) {
      if (this.ended) return undefined
      await new Promise<void>((resolve) => this.waiters.push(resolve))
    }
    return this.frames.shift()
  }

  private wake(): void {
    for (const waiter of this.waiters.splice(0)) waiter()
  }
}

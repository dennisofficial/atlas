import type { PodSample } from '@dltech/atlas-protocol'

const CAPACITY = 300

export class PodMetricsQueue {
  private samples: PodSample[] = []
  private ended = false
  private readonly waiters: (() => void)[] = []

  push(sample: PodSample): void {
    if (this.ended) return
    this.samples.push(sample)
    if (this.samples.length > CAPACITY) this.samples.shift()
    this.wake()
  }

  end(): void {
    if (this.ended) return
    this.ended = true
    this.wake()
  }

  async next(): Promise<PodSample | undefined> {
    while (this.samples.length === 0) {
      if (this.ended) return undefined
      await new Promise<void>((resolve) => this.waiters.push(resolve))
    }
    return this.samples.shift()
  }

  private wake(): void {
    for (const waiter of this.waiters.splice(0)) waiter()
  }
}

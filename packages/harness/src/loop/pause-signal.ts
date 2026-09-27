export class PauseSignal {
  private isPaused = false
  private waiters: (() => void)[] = []
  private readonly listeners = new Set<() => void>()

  get paused(): boolean {
    return this.isPaused
  }

  pause(): void {
    if (this.isPaused) return
    this.isPaused = true
    for (const listener of [...this.listeners]) listener()
  }

  resume(): void {
    this.isPaused = false
    const held = this.waiters
    this.waiters = []
    for (const release of held) release()
  }

  waitIfPaused(): Promise<void> {
    if (!this.isPaused) return Promise.resolve()
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve)
    })
  }

  onPause(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}

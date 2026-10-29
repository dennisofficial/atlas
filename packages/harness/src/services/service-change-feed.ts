export class ServiceChangeFeed {
  private revision = 0
  private flushQueued = false
  private readonly listeners = new Set<() => void>()
  private readonly settledListeners = new Set<() => void>()

  version(): number {
    return this.revision
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onSettled(listener: () => void): () => void {
    this.settledListeners.add(listener)
    return () => this.settledListeners.delete(listener)
  }

  announceSettled(): void {
    for (const listener of [...this.settledListeners]) listener()
  }

  bump(): void {
    this.revision += 1
    if (this.flushQueued) return
    this.flushQueued = true
    queueMicrotask(() => {
      this.flushQueued = false
      for (const listener of this.listeners) listener()
    })
  }

  clear(): void {
    this.listeners.clear()
    this.settledListeners.clear()
  }
}

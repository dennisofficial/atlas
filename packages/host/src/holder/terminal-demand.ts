export type TerminalDemandObservers = {
  onWork(sessionId: string): void
  onIdle(sessionId: string): void
}

export class TerminalDemand {
  private readonly counts = new Map<string, number>()
  private observers: TerminalDemandObservers = {
    onWork: () => undefined,
    onIdle: () => undefined,
  }

  observe(observers: TerminalDemandObservers): void {
    this.observers = observers
  }

  countOf(sessionId: string): number {
    return this.counts.get(sessionId) ?? 0
  }

  hold(sessionId: string): () => void {
    const count = this.countOf(sessionId) + 1
    this.counts.set(sessionId, count)
    if (count === 1) this.observers.onWork(sessionId)
    let released = false
    return () => {
      if (released) return
      released = true
      const next = this.countOf(sessionId) - 1
      if (next > 0) {
        this.counts.set(sessionId, next)
        return
      }
      this.counts.delete(sessionId)
      this.observers.onIdle(sessionId)
    }
  }
}

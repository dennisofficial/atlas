export class ChangeNotifier {
  private revision = 0
  private readonly listeners = new Set<() => void>()

  version(): number {
    return this.revision
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  notify(): void {
    this.revision += 1
    for (const listener of [...this.listeners]) listener()
  }

  clear(): void {
    this.listeners.clear()
  }
}

export class Serial {
  private tail: Promise<unknown> = Promise.resolve()

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task)
    this.tail = result.catch(() => undefined)
    return result
  }
}

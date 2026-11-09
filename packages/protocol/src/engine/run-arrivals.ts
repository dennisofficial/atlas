export class RunArrivals {
  private count = 0
  private readonly waiting = new Map<string, number>()
  private readonly cancelledThrough = new Map<string, number>()

  arrive(key: string): number {
    this.count += 1
    this.waiting.set(key, (this.waiting.get(key) ?? 0) + 1)
    return this.count
  }

  leave(key: string): void {
    const left = (this.waiting.get(key) ?? 1) - 1
    if (left > 0) this.waiting.set(key, left)
    else this.waiting.delete(key)
  }

  isWaiting(key: string): boolean {
    return this.waiting.has(key)
  }

  cancel(key: string): void {
    this.cancelledThrough.set(key, this.count)
  }

  forget(key: string): void {
    this.cancelledThrough.delete(key)
  }

  controllerFor(args: { key: string; arrival: number }): AbortController {
    const controller = new AbortController()
    if (args.arrival <= (this.cancelledThrough.get(args.key) ?? 0)) controller.abort()
    return controller
  }
}

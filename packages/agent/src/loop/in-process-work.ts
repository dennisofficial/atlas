export type InProcessWork = {
  begin(): () => void
}

export class InProcessWorkCounter implements InProcessWork {
  private count = 0
  private readonly waiters: (() => void)[] = []

  get running(): boolean {
    return this.count > 0
  }

  begin(): () => void {
    this.count += 1
    let ended = false
    return () => {
      if (ended) return
      ended = true
      this.count -= 1
      if (this.count > 0) return
      for (const resolve of this.waiters.splice(0)) resolve()
    }
  }

  whenIdle(): Promise<void> {
    if (this.count === 0) return Promise.resolve()
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve)
    })
  }
}

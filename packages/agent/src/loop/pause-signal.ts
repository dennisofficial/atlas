export class PauseSignal {
  private isPaused = false
  private waiters: (() => void)[] = []
  private readonly listeners = new Set<() => void>()
  private readonly modelAborters = new Set<() => void>()
  private modelSteps = 0
  private readonly modelIdle: (() => void)[] = []
  private stepSettles = 0
  private readonly stepSettledWaiters: (() => void)[] = []

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

  beginModelStep(): (() => void) | undefined {
    if (this.isPaused) return undefined
    this.modelSteps += 1
    let ended = false
    return () => {
      if (ended) return
      ended = true
      this.modelSteps -= 1
      if (this.modelSteps > 0) return
      const idle = this.modelIdle.splice(0)
      for (const resolve of idle) resolve()
    }
  }

  get modelStepRunning(): boolean {
    return this.modelSteps > 0
  }

  whenModelIdle(): Promise<void> {
    if (this.modelSteps === 0) return Promise.resolve()
    return new Promise<void>((resolve) => {
      this.modelIdle.push(resolve)
    })
  }

  beginStepSettle(): () => void {
    this.stepSettles += 1
    let released = false
    return () => {
      if (released) return
      released = true
      this.stepSettles -= 1
      if (this.stepSettles > 0) return
      const settled = this.stepSettledWaiters.splice(0)
      for (const resolve of settled) resolve()
    }
  }

  get stepSettling(): boolean {
    return this.stepSettles > 0
  }

  whenStepSettled(): Promise<void> {
    if (this.stepSettles === 0) return Promise.resolve()
    return new Promise<void>((resolve) => {
      this.stepSettledWaiters.push(resolve)
    })
  }

  abortModelStep(): void {
    for (const abort of [...this.modelAborters]) abort()
  }

  onModelAbort(listener: () => void): () => void {
    this.modelAborters.add(listener)
    return () => {
      this.modelAborters.delete(listener)
    }
  }
}

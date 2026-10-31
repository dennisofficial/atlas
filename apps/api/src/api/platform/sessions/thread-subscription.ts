import type { ThreadSignalBus } from './thread-signal.bus'

type Subscription = ReturnType<typeof Promise.withResolvers<void>>

export class ThreadSubscription {
  private pending: Subscription | undefined

  constructor(
    private readonly args: {
      bus: ThreadSignalBus
      onMessage: (raw: string) => void
      onFailure: (failure: unknown) => void
    },
  ) {}

  ensureSubscribed(): void {
    if (this.pending !== undefined) return
    const pending = Promise.withResolvers<void>()
    this.pending = pending
    void pending.promise.catch(() => {})
    const handleFailure = (failure: unknown): void => {
      if (this.pending !== pending) return
      pending.reject(failure)
      this.args.onFailure(failure)
    }
    try {
      const ready = this.args.bus.subscribe({
        onMessage: (raw) => {
          if (this.pending === pending) this.args.onMessage(raw)
        },
        onClosed: () => handleFailure(new Error('thread signal subscription interrupted')),
      })
      void Promise.resolve(ready).then(() => pending.resolve(), handleFailure)
    } catch (failure) {
      handleFailure(failure)
    }
  }

  awaitSubscription(): Promise<void> {
    return this.pending?.promise ?? Promise.reject(new Error('thread signal subscription closed'))
  }

  reset(): void {
    this.pending?.reject(new Error('thread signal subscription closed'))
    this.pending = undefined
  }
}

import type { ThreadId } from '@dltech/atlas-core'

import type { InputBatch } from './input-batch'

export type IntakeSource<TSubmitted = never> = {
  prepare: (args: { threadId: ThreadId }) => InputBatch | Promise<InputBatch>
  threadsAwaitingInput: () => readonly ThreadId[]
  threadsWithPendingInput?: (() => readonly ThreadId[]) | undefined
  subscribe: (listener: () => void) => () => void
  witness?: ((args: { threadId: ThreadId }) => unknown) | undefined
  submit?: ((args: TSubmitted) => void) | undefined
}

export type IntakeDriver = {
  blocked: () => boolean
  wake: () => void | Promise<unknown>
}

/**
 * A pending notice whose wake keeps failing is never abandoned the way the old attempt cap stranded
 * it: each consecutive failure backs off further, so a transient crash (a workspace mid-park, a
 * refresh hiccup) delivers on a later wake while a doomed turn retries slowly instead of spinning.
 * A drained notice or a changed witness resets the backoff to zero, so a healthy thread wakes at
 * once.
 */
const WAKE_BACKOFF_BASE_MS = 1_000
const WAKE_BACKOFF_CAP_MS = 30_000

const wakeBackoffMs = (consecutiveFailures: number): number =>
  Math.min(WAKE_BACKOFF_BASE_MS * 2 ** Math.max(0, consecutiveFailures - 1), WAKE_BACKOFF_CAP_MS)

export abstract class IntakeWakeScheduler<TSubmitted = never> {
  protected readonly sources: readonly IntakeSource<TSubmitted>[]
  protected readonly submitInput: ((args: TSubmitted) => void) | undefined
  protected readonly heldDrivers = new Map<ThreadId, number>()
  protected readonly unsubscribe: readonly (() => void)[]
  protected readonly drivers = new Map<ThreadId, IntakeDriver>()
  protected readonly attempts = new Map<
    ThreadId,
    { witness: readonly unknown[]; failures: number; nextAt: number }
  >()
  protected readonly waking = new Set<ThreadId>()
  protected readonly preparing = new Map<ThreadId, { done: Promise<void>; finish: () => void }>()
  protected queued = false
  protected closed = false
  protected suspended = 0
  protected lastBusy = false
  protected readonly listeners = new Set<() => void>()
  protected fallback: ((args: { threadId: ThreadId }) => IntakeDriver | undefined) | undefined
  protected readonly now: () => number
  protected readonly backoff: (consecutiveFailures: number) => number
  protected readonly retryTimers = new Map<ThreadId, ReturnType<typeof setTimeout>>()

  constructor(args: {
    sources: readonly IntakeSource<TSubmitted>[]
    submit?: ((args: TSubmitted) => void) | undefined
    now?: (() => number) | undefined
    backoff?: ((consecutiveFailures: number) => number) | undefined
  }) {
    this.sources = args.sources
    this.submitInput =
      args.submit ?? args.sources.find((source) => source.submit !== undefined)?.submit
    this.now = args.now ?? Date.now
    this.backoff = args.backoff ?? wakeBackoffMs
    this.unsubscribe = args.sources.map((source) => source.subscribe(() => this.changed()))
  }

  abstract threadsWithPendingInput(): readonly ThreadId[]

  busy(): boolean {
    if (this.preparing.size > 0 || this.waking.size > 0 || this.queued) return true
    const pending = new Set(this.threadsWithPendingInput())
    for (const threadId of this.heldDrivers.keys()) {
      if (pending.has(threadId)) return true
    }
    return false
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  hold(args: { threadId: ThreadId }): () => void {
    this.heldDrivers.set(args.threadId, (this.heldDrivers.get(args.threadId) ?? 0) + 1)
    this.announceIfBusyChanged()
    let released = false
    return () => {
      if (released) return
      released = true
      const count = (this.heldDrivers.get(args.threadId) ?? 1) - 1
      if (count > 0) this.heldDrivers.set(args.threadId, count)
      else this.heldDrivers.delete(args.threadId)
      this.announceIfBusyChanged()
      this.changed()
    }
  }

  register(args: { threadId: ThreadId; driver: IntakeDriver }): () => void {
    this.drivers.set(args.threadId, args.driver)
    this.changed()
    return () => {
      if (this.drivers.get(args.threadId) === args.driver) this.drivers.delete(args.threadId)
    }
  }

  registerFallback(resolve: (args: { threadId: ThreadId }) => IntakeDriver | undefined): void {
    this.fallback = resolve
    this.changed()
  }

  changed(): void {
    if (this.queued || this.closed) return
    this.queued = true
    this.announceIfBusyChanged()
    queueMicrotask(() => {
      this.queued = false
      if (!this.closed) this.recheck()
      queueMicrotask(() => {
        if (this.closed) return
        this.announceIfBusyChanged()
      })
    })
  }

  /**
   * Suspend is refcounted: every gate holds the intake until its own resume, so overlapping
   * suspends (rotation guard, drain, park, teardown) cannot leave the intake wedged by resuming
   * on behalf of a gate that is still holding, nor strand it suspended when one gate forgets.
   * The intake wakes again only once the last gate has released. Prefer `gate()` where a caller
   * holds the intake across an await — its release runs on both the success and the throw path.
   */
  suspend(): () => void {
    this.suspended += 1
    let held = true
    return () => {
      if (!held) return
      held = false
      this.resume()
    }
  }

  resume(): void {
    if (this.suspended === 0) return
    this.suspended -= 1
    if (this.suspended === 0) this.changed()
  }

  /** Suspend for the span of `span`, releasing exactly once however it settles. */
  async gate<T>(span: () => Promise<T>): Promise<T> {
    const release = this.suspend()
    try {
      return await span()
    } finally {
      release()
    }
  }

  dispose(): void {
    this.closed = true
    this.suspended = 0
    for (const timer of this.retryTimers.values()) clearTimeout(timer)
    this.retryTimers.clear()
    for (const unsubscribe of this.unsubscribe) unsubscribe()
    this.drivers.clear()
    this.attempts.clear()
    this.waking.clear()
    this.heldDrivers.clear()
    this.fallback = undefined
    for (const reservation of this.preparing.values()) reservation.finish()
    this.preparing.clear()
    this.listeners.clear()
  }

  protected announceIfBusyChanged(): void {
    const now = this.busy()
    if (now === this.lastBusy) return
    this.lastBusy = now
    for (const listener of [...this.listeners]) listener()
  }

  /**
   * The thread stays in `waking` until the launched turn settles, so `busy()` keeps reporting an
   * in-flight wake-turn — the park decision reads it — and the settle then re-drives the recheck:
   * a drained turn cleared its backoff through `prepare`'s acknowledge and wakes nothing, while one
   * that died undelivered is retried on the backoff its failure count already advanced to.
   */
  protected settleWakeTurn(args: { threadId: ThreadId; settled: void | Promise<unknown> }): void {
    const release = (): void => {
      this.waking.delete(args.threadId)
      this.changed()
    }
    if (args.settled === undefined || args.settled === null) {
      release()
      return
    }
    void Promise.resolve(args.settled)
      .catch(() => undefined)
      .then(release)
  }

  /**
   * Re-drive is synchronous: a settle or a state change calls recheck directly, and when a failure
   * is still backing off recheck arms one timer for the remaining gap. The retry always waits at
   * least one macrotask, even at zero backoff — a wake that fails instantly would otherwise spin
   * the microtask queue forever, never yielding to a timer or a settle.
   */
  protected scheduleRetry(threadId: ThreadId, at: number): void {
    if (this.retryTimers.has(threadId)) return
    const gap = Math.max(1, at - this.now())
    const timer = setTimeout(() => {
      this.retryTimers.delete(threadId)
      this.changed()
    }, gap)
    timer.unref?.()
    this.retryTimers.set(threadId, timer)
  }

  protected recheck(): void {
    if (this.suspended > 0) return
    const awaiting = new Set(this.sources.flatMap((source) => [...source.threadsAwaitingInput()]))
    for (const threadId of this.attempts.keys()) {
      if (!awaiting.has(threadId)) {
        this.attempts.delete(threadId)
        this.retryTimers.delete(threadId)
      }
    }
    for (const threadId of awaiting) {
      const driver = this.drivers.get(threadId) ?? this.fallback?.({ threadId })
      if (
        driver === undefined ||
        driver.blocked() ||
        this.waking.has(threadId) ||
        this.heldDrivers.has(threadId)
      )
        continue
      const witness = this.sources.map((source) => source.witness?.({ threadId }) ?? source)
      const prior = this.attempts.get(threadId)
      const failures =
        prior !== undefined && prior.witness.every((value, index) => value === witness[index])
          ? prior.failures
          : 0
      const readyAt = prior === undefined || failures === 0 ? 0 : prior.nextAt
      if (readyAt > this.now()) {
        this.scheduleRetry(threadId, readyAt)
        continue
      }
      this.retryTimers.delete(threadId)
      this.waking.add(threadId)
      this.announceIfBusyChanged()
      void Promise.resolve()
        .then(() => {
          if (
            driver.blocked() ||
            this.closed ||
            this.suspended > 0 ||
            this.heldDrivers.has(threadId)
          ) {
            // A wake that found the driver blocked never fired, so it is not a failure: the attempt
            // count is left untouched, and the re-drive retries it at once rather than after a
            // backoff it did not earn. A persistently blocked driver never gets here — the outer
            // check already continued — so this cannot spin.
            this.waking.delete(threadId)
            this.changed()
            return
          }
          this.attempts.set(threadId, {
            witness,
            failures: failures + 1,
            nextAt: this.now() + this.backoff(failures + 1),
          })
          let settled: void | Promise<unknown>
          try {
            settled = driver.wake()
          } catch {
            settled = undefined
          }
          this.settleWakeTurn({ threadId, settled })
        })
        .catch(() => {
          this.waking.delete(threadId)
          this.changed()
        })
    }
  }
}

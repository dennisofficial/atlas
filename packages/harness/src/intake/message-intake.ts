import type { ThreadId } from '@dltech/atlas-core'
import type { PendingQueue } from '../pending/pending-queue'

import { combineInput, type InputBatch } from './input-batch'
import { waitForInput } from './wait-for-input'

export type IntakeSource = {
  prepare: (args: { threadId: ThreadId }) => InputBatch | Promise<InputBatch>
  threadsAwaitingInput: () => readonly ThreadId[]
  threadsWithPendingInput?: (() => readonly ThreadId[]) | undefined
  subscribe: (listener: () => void) => () => void
  witness?: ((args: { threadId: ThreadId }) => unknown) | undefined
  submit?: ((args: SubmittedInput) => void) | undefined
}

export type IntakeDriver = {
  blocked: () => boolean
  wake: () => void | Promise<unknown>
}

export type SubmittedInput = Parameters<PendingQueue['enqueue']>[0] & { threadId: ThreadId }

const MAX_WAKE_ATTEMPTS = 3

export class MessageIntake {
  private readonly sources: readonly IntakeSource[]
  private readonly submitInput: ((args: SubmittedInput) => void) | undefined
  private readonly heldDrivers = new Map<ThreadId, number>()
  private readonly unsubscribe: readonly (() => void)[]
  private readonly drivers = new Map<ThreadId, IntakeDriver>()
  private readonly attempts = new Map<ThreadId, { witness: readonly unknown[]; count: number }>()
  private readonly waking = new Set<ThreadId>()
  private readonly preparing = new Map<ThreadId, { done: Promise<void>; finish: () => void }>()
  private queued = false
  private closed = false
  private suspended = false
  private lastBusy = false
  private readonly listeners = new Set<() => void>()
  private fallback: ((args: { threadId: ThreadId }) => IntakeDriver | undefined) | undefined

  constructor(args: { sources: readonly IntakeSource[]; submit?: ((args: SubmittedInput) => void) | undefined }) {
    this.sources = args.sources
    this.submitInput = args.submit ?? args.sources.find((source) => source.submit !== undefined)?.submit
    this.unsubscribe = args.sources.map((source) => source.subscribe(() => this.changed()))
  }

  submit(args: SubmittedInput): void {
    if (this.closed) throw new Error('message intake is closed')
    if (this.submitInput === undefined) throw new Error('message intake has no operator source')
    this.submitInput(args)
    this.changed()
  }

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

  async prepare(args: { threadId: ThreadId; signal?: AbortSignal | undefined }): Promise<InputBatch> {
    args.signal?.throwIfAborted()
    if (this.closed) throw new Error('message intake is closed')
    for (;;) {
      const prior = this.preparing.get(args.threadId)
      if (prior === undefined) break
      await waitForInput({ done: prior.done, signal: args.signal })
      args.signal?.throwIfAborted()
      if (this.closed) throw new Error('message intake is closed')
    }
    let releaseReservation = (): void => undefined
    const done = new Promise<void>((resolve) => { releaseReservation = resolve })
    const reservation = { done, finish: releaseReservation }
    this.preparing.set(args.threadId, reservation)
    this.announceIfBusyChanged()
    const unlock = (): void => {
      if (this.preparing.get(args.threadId) === reservation) this.preparing.delete(args.threadId)
      reservation.finish()
      this.announceIfBusyChanged()
    }
    const batches: InputBatch[] = []
    try {
      for (const source of this.sources) batches.push(await source.prepare(args))
      args.signal?.throwIfAborted()
      if (this.closed) throw new Error('message intake is closed')
    } catch (error) {
      for (const batch of batches) batch.release?.()
      unlock()
      throw error
    }
    const batch = combineInput(batches)
    let settled = false
    const finish = (acknowledged: boolean): void => {
      if (settled) return
      settled = true
      try {
        if (acknowledged) batch.acknowledge()
        else batch.release?.()
      } finally {
        unlock()
        if (acknowledged && batch.drafts.length > 0) this.attempts.delete(args.threadId)
        this.changed()
      }
    }
    return { ...batch, acknowledge: () => finish(true), release: () => finish(false) }
  }

  async commit(args: {
    threadId: ThreadId
    signal?: AbortSignal | undefined
    append: (drafts: InputBatch['drafts']) => Promise<void>
  }): Promise<{ drafts: InputBatch['drafts']; wakesTurn: boolean }> {
    const batch = await this.prepare(args)
    try {
      if (batch.drafts.length > 0) await args.append(batch.drafts)
      batch.acknowledge()
      return { drafts: batch.drafts, wakesTurn: batch.wakesTurn }
    } finally {
      batch.release?.()
    }
  }

  threadsWithPendingInput(): readonly ThreadId[] {
    return [...new Set(this.sources.flatMap((source) => [...(
      source.threadsWithPendingInput?.() ?? source.threadsAwaitingInput()
    )]))]
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

  suspend(): void {
    this.suspended = true
  }

  resume(): void {
    if (!this.suspended) return
    this.suspended = false
    this.changed()
  }

  dispose(): void {
    this.closed = true
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

  private announceIfBusyChanged(): void {
    const now = this.busy()
    if (now === this.lastBusy) return
    this.lastBusy = now
    for (const listener of [...this.listeners]) listener()
  }

  private recheck(): void {
    if (this.suspended) return
    const awaiting = new Set(this.sources.flatMap((source) => [...source.threadsAwaitingInput()]))
    for (const threadId of this.attempts.keys()) {
      if (!awaiting.has(threadId)) this.attempts.delete(threadId)
    }
    for (const threadId of awaiting) {
      const driver = this.drivers.get(threadId) ?? this.fallback?.({ threadId })
      if (driver === undefined || driver.blocked() || this.waking.has(threadId) || this.heldDrivers.has(threadId)) continue
      const witness = this.sources.map((source) => source.witness?.({ threadId }) ?? source)
      const prior = this.attempts.get(threadId)
      const count = prior !== undefined && prior.witness.every((value, index) => value === witness[index])
        ? prior.count : 0
      if (count >= MAX_WAKE_ATTEMPTS) continue
      this.waking.add(threadId)
      this.announceIfBusyChanged()
      void Promise.resolve().then(() => {
        if (driver.blocked() || this.closed || this.suspended || this.heldDrivers.has(threadId)) return
        this.attempts.set(threadId, { witness, count: count + 1 })
        return driver.wake()
      }).catch(() => undefined).finally(() => {
        this.waking.delete(threadId)
        this.changed()
      })
    }
  }
}

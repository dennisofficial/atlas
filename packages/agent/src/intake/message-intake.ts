import type { ThreadId } from '@dltech/atlas-core'

import { combineInput, type InputBatch } from './input-batch'
import { IntakeWakeScheduler, type IntakeDriver, type IntakeSource } from './intake-wake-scheduler'
import { waitForInput } from './wait-for-input'

export type { IntakeDriver, IntakeSource }

export class MessageIntake<TSubmitted = never> extends IntakeWakeScheduler<TSubmitted> {
  submit(args: TSubmitted): void {
    if (this.closed) throw new Error('message intake is closed')
    if (this.submitInput === undefined) throw new Error('message intake has no operator source')
    this.submitInput(args)
    this.changed()
  }

  async prepare(args: {
    threadId: ThreadId
    signal?: AbortSignal | undefined
  }): Promise<InputBatch> {
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
    const done = new Promise<void>((resolve) => {
      releaseReservation = resolve
    })
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
    return [
      ...new Set(
        this.sources.flatMap((source) => [
          ...(source.threadsWithPendingInput?.() ?? source.threadsAwaitingInput()),
        ]),
      ),
    ]
  }
}

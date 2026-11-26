import { ECallError, stepCalls, type SteppedCalls } from '@dltech/atlas-core'

import type { LiveCall } from './live-call'
import { type LedgerOutcome, type RefusedOutcome, staleEpoch, unknownKey } from './outcomes'
import type { RunArrivals } from './run-arrivals'

export type ScopeCancelOutcome = { ok: true; cancelled: readonly string[] } | RefusedOutcome

export const cancelOf = (args: {
  state: SteppedCalls
  key: string
  epoch: number
  calls: ReadonlyMap<string, LiveCall>
  arrivals: RunArrivals
}): LedgerOutcome => {
  const stepped = stepCalls({
    state: args.state,
    input: { type: 'cancel', key: args.key, epoch: args.epoch },
  })
  if (stepped.effects.errors.includes(ECallError.StaleEpoch)) return staleEpoch(args.epoch)
  const call = args.calls.get(args.key)
  if (call === undefined) {
    if (!args.arrivals.isWaiting(args.key)) return unknownKey(args.key)
    args.arrivals.cancel(args.key)
    return { ok: true }
  }
  if (!stepped.effects.cancelled.includes(args.key)) return { ok: true }
  args.arrivals.cancel(args.key)
  call.abort.abort()
  return { ok: true }
}

export const abortAllOf = (args: { calls: Iterable<LiveCall> }): void => {
  for (const call of args.calls) call.abort.abort()
}

const STEP_SUFFIX = /^(?:\d+|read\.[0-9a-f]{8}|no-step\.[0-9a-f]{8})$/

export class ScopeCancels {
  private readonly settled = new Map<string, Promise<void>>()
  private readonly arrivals = new Map<string, Promise<void>>()

  track(args: { key: string; running: Promise<void> }): void {
    this.settled.set(args.key, args.running)
    const forget = (): void => {
      if (this.settled.get(args.key) === args.running) this.settled.delete(args.key)
    }
    void args.running.then(forget, forget)
  }

  trackArrival(args: { key: string; done: Promise<unknown> }): void {
    const done = args.done.then(
      () => undefined,
      () => undefined,
    )
    this.arrivals.set(args.key, done)
    const forget = (): void => {
      if (this.arrivals.get(args.key) === done) this.arrivals.delete(args.key)
    }
    void done.then(forget, forget)
  }

  async cancel(args: {
    state: SteppedCalls
    scope: string
    epoch: number
    calls: ReadonlyMap<string, LiveCall>
    arrivals: RunArrivals
  }): Promise<ScopeCancelOutcome> {
    if (args.epoch < args.state.epoch) return staleEpoch(args.epoch)
    const keys = this.keysUnder(args)
    for (const key of keys) {
      args.arrivals.cancel(key)
      args.calls.get(key)?.abort.abort()
    }
    await this.awaitTerminals(keys)
    return { ok: true, cancelled: keys }
  }

  private async awaitTerminals(keys: readonly string[]): Promise<void> {
    let seen: readonly Promise<void>[] = []
    for (;;) {
      const waiting = this.waitingFor(keys)
      if (waiting.length === 0) return
      if (waiting.every((promise) => seen.includes(promise))) return
      seen = waiting
      await Promise.all(waiting)
    }
  }

  private waitingFor(keys: readonly string[]): Promise<void>[] {
    const waiting: Promise<void>[] = []
    for (const key of keys) {
      const settled = this.settled.get(key)
      if (settled !== undefined) waiting.push(settled)
      const arrival = this.arrivals.get(key)
      if (arrival !== undefined) waiting.push(arrival)
    }
    return waiting
  }

  private keysUnder(args: {
    scope: string
    calls: ReadonlyMap<string, LiveCall>
    arrivals: RunArrivals
  }): readonly string[] {
    return [...new Set([...args.calls.keys(), ...args.arrivals.keys()])]
      .filter((key) => key.startsWith(`${args.scope}.`))
      .filter((key) => STEP_SUFFIX.test(key.slice(args.scope.length + 1)))
  }
}

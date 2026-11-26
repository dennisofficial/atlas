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

export class ScopeCancels {
  private readonly settled = new Map<string, Promise<void>>()

  track(args: { key: string; running: Promise<void> }): void {
    this.settled.set(args.key, args.running)
    void args.running.finally(() => {
      if (this.settled.get(args.key) === args.running) this.settled.delete(args.key)
    })
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
    const settled = keys.flatMap((key) => this.settled.get(key) ?? [])
    for (const key of keys) {
      args.arrivals.cancel(key)
      args.calls.get(key)?.abort.abort()
    }
    await Promise.all(settled)
    return { ok: true, cancelled: keys }
  }

  private keysUnder(args: {
    scope: string
    calls: ReadonlyMap<string, LiveCall>
    arrivals: RunArrivals
  }): readonly string[] {
    const prefix = `${args.scope}.`
    return [...new Set([...args.calls.keys(), ...args.arrivals.keys()])].filter((key) =>
      key.startsWith(prefix),
    )
  }
}

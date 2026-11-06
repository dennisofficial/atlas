import type { ScheduledRetry } from '@dltech/atlas-core'

import { OnceLedger } from '../loop/once-ledger.port'

export class InMemoryOnceLedger extends OnceLedger {
  private readonly facts = new Map<string, unknown>()
  private readonly pending = new Map<string, Promise<unknown>>()
  private readonly retries = new Map<string, ScheduledRetry>()
  private readonly pendingRetries = new Map<string, Promise<ScheduledRetry>>()

  record(key: string, value: unknown): void {
    this.facts.set(key, value)
  }

  recordRetry(retry: ScheduledRetry): void {
    this.retries.set(retry.key, retry)
  }

  has(key: string): boolean {
    return this.facts.has(key) || this.retries.has(key)
  }

  keys(): string[] {
    return [...this.facts.keys()]
  }

  retryKeys(): string[] {
    return [...this.retries.keys()]
  }

  recallRetries(args: { prefix: string }): Promise<readonly ScheduledRetry[]> {
    return Promise.resolve(
      [...this.retries.values()].filter((retry) => retry.key.startsWith(args.prefix)),
    )
  }

  scheduleRetry(args: {
    key: string
    decide: () => Promise<Omit<ScheduledRetry, 'key'>>
  }): Promise<ScheduledRetry> {
    const recorded = this.retries.get(args.key)
    if (recorded !== undefined) return Promise.resolve(recorded)
    const inFlight = this.pendingRetries.get(args.key)
    if (inFlight !== undefined) return inFlight
    const deciding = args.decide().then((decided) => {
      const retry: ScheduledRetry = { key: args.key, ...decided }
      this.retries.set(args.key, retry)
      return retry
    })
    this.pendingRetries.set(args.key, deciding)
    const settle = () => this.pendingRetries.delete(args.key)
    deciding.then(settle, settle)
    return deciding
  }

  recall(args: { prefix: string }): Promise<readonly { key: string; value: unknown }[]> {
    const matches: { key: string; value: unknown }[] = []
    for (const [key, value] of this.facts) {
      if (key.startsWith(args.prefix)) matches.push({ key, value })
    }
    return Promise.resolve(matches)
  }

  once<T>(args: { key: string; decide: () => Promise<T> }): Promise<T> {
    const recorded = this.facts.get(args.key)
    if (recorded !== undefined || this.facts.has(args.key)) {
      return Promise.resolve(recorded as T)
    }
    const inFlight = this.pending.get(args.key)
    if (inFlight !== undefined) return inFlight as Promise<T>
    const deciding = args.decide().then((value) => {
      this.facts.set(args.key, value)
      return value as unknown
    })
    this.pending.set(args.key, deciding)
    deciding.then(
      () => this.pending.delete(args.key),
      () => this.pending.delete(args.key),
    )
    return deciding as Promise<T>
  }
}

import { OnceLedger } from '../loop/once-ledger.port'

export class InMemoryOnceLedger extends OnceLedger {
  private readonly facts = new Map<string, unknown>()
  private readonly pending = new Map<string, Promise<unknown>>()

  record(key: string, value: unknown): void {
    this.facts.set(key, value)
  }

  has(key: string): boolean {
    return this.facts.has(key)
  }

  keys(): string[] {
    return [...this.facts.keys()]
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

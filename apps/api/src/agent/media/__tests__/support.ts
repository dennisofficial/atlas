import type { MediaSigningWindows, SigningWindowRow } from '../media-signing-windows'

export class MemoryMediaSigningWindows implements MediaSigningWindows {
  readonly rows = new Map<number, SigningWindowRow>()
  inserts = 0

  async find(windowStart: number): Promise<SigningWindowRow | null> {
    return this.rows.get(windowStart) ?? null
  }

  async insertIfAbsent(args: {
    windowStart: number
    validUntil: number
    sealed: string
  }): Promise<void> {
    this.inserts += 1
    if (this.rows.has(args.windowStart)) return
    this.rows.set(args.windowStart, { validUntil: args.validUntil, sealed: args.sealed })
  }
}

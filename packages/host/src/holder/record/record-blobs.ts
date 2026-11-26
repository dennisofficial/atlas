import { blobRefsOf, canonicalJson, type RecordEventBody } from '@dltech/atlas-core'

const valueBytes = (value: unknown): number =>
  new TextEncoder().encode(canonicalJson(value)).byteLength

export class RecordBlobs {
  private values = new Map<string, unknown>()
  private sizes = new Map<string, number>()

  valuesOf(): ReadonlyMap<string, unknown> {
    return this.values
  }

  has(hash: string): boolean {
    return this.values.has(hash)
  }

  size(): number {
    return this.values.size
  }

  retain(args: { hash: string; value: unknown; bytes: number }): void {
    this.values.set(args.hash, args.value)
    this.sizes.set(args.hash, args.bytes)
  }

  retainLocal(args: { hash: string; value: unknown }): void {
    this.retain({ hash: args.hash, value: args.value, bytes: valueBytes(args.value) })
  }

  retainedBytes(): number {
    let total = 0
    for (const bytes of this.sizes.values()) total += bytes
    return total
  }

  prune(events: readonly RecordEventBody[]): void {
    const referenced = new Set<string>()
    for (const event of events) {
      for (const ref of blobRefsOf(event)) referenced.add(ref.hash)
    }
    for (const hash of [...this.values.keys()]) {
      if (referenced.has(hash)) continue
      this.values.delete(hash)
      this.sizes.delete(hash)
    }
  }

  copy(): RecordBlobs {
    const copy = new RecordBlobs()
    copy.values = new Map(this.values)
    copy.sizes = new Map(this.sizes)
    return copy
  }
}

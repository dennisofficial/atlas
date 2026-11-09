import type { FetchedPage } from '@dltech/atlas-core'

export const CACHE_TTL_MS = 15 * 60 * 1000

const MAX_ENTRIES = 32

type Entry = { page: FetchedPage; storedAt: number }

export class PageCache {
  private readonly entries = new Map<string, Entry>()

  constructor(private readonly now: () => number = Date.now) {}

  private static keyOf(args: { url: string; format: string }): string {
    return `${args.format} ${args.url}`
  }

  read(args: { url: string; format: string }): FetchedPage | undefined {
    const key = PageCache.keyOf(args)
    const found = this.entries.get(key)
    if (found === undefined) return undefined

    if (this.now() - found.storedAt >= CACHE_TTL_MS) {
      this.entries.delete(key)
      return undefined
    }

    this.entries.delete(key)
    this.entries.set(key, found)
    return found.page
  }

  write(args: { url: string; format: string; page: FetchedPage }): void {
    const key = PageCache.keyOf(args)
    this.entries.delete(key)
    this.entries.set(key, { page: args.page, storedAt: this.now() })

    while (this.entries.size > MAX_ENTRIES) {
      const oldest = this.entries.keys().next()
      if (oldest.done === true) break
      this.entries.delete(oldest.value)
    }
  }
}

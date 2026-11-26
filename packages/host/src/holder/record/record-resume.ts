import type { ThreadId } from '@dltech/atlas-core'

import type { RecordCache } from './record-cache'

export const RECORD_RESUME_MAX_BYTES = 64 * 1024 * 1024
export const RECORD_RESUME_MAX_RECORD_BYTES = 16 * 1024 * 1024

export class RecordResumeCache {
  private readonly records = new Map<string, RecordCache>()
  private readonly maxBytes: number
  private readonly maxRecordBytes: number

  constructor(args: { maxBytes?: number | undefined; maxRecordBytes?: number | undefined } = {}) {
    this.maxBytes = args.maxBytes ?? RECORD_RESUME_MAX_BYTES
    this.maxRecordBytes = args.maxRecordBytes ?? RECORD_RESUME_MAX_RECORD_BYTES
  }

  take(threadId: ThreadId): RecordCache | undefined {
    const cache = this.records.get(threadId)
    if (cache === undefined) return undefined
    this.records.delete(threadId)
    return cache
  }

  keep(cache: RecordCache): void {
    const threadId = cache.threadId()
    this.records.delete(threadId)
    if (cache.resumable() && cache.retainedBytes() <= this.maxRecordBytes) {
      this.records.set(threadId, cache)
    }
    this.trim()
  }

  size(): number {
    return this.records.size
  }

  retainedBytes(): number {
    let total = 0
    for (const cache of this.records.values()) total += cache.retainedBytes()
    return total
  }

  private trim(): void {
    while (this.retainedBytes() > this.maxBytes) {
      const oldest = this.records.keys().next().value
      if (oldest === undefined) return
      this.records.delete(oldest)
    }
  }
}

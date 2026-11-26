import type { ThreadId } from '@dltech/atlas-core'

import type { RecordCache } from './record-cache'

export const RECORD_RESUME_LIMIT = 200

export class RecordResumeCache {
  private readonly records = new Map<string, RecordCache>()

  take(threadId: ThreadId): RecordCache | undefined {
    const cache = this.records.get(threadId)
    if (cache === undefined) return undefined
    this.records.delete(threadId)
    return cache
  }

  keep(cache: RecordCache): void {
    const threadId = cache.threadId()
    this.records.delete(threadId)
    this.records.set(threadId, cache)
    while (this.records.size > RECORD_RESUME_LIMIT) {
      const oldest = this.records.keys().next().value
      if (oldest === undefined) return
      this.records.delete(oldest)
    }
  }

  size(): number {
    return this.records.size
  }
}

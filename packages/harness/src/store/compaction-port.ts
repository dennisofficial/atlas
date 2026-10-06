import type { ECompactionAnchor, ThreadId } from '@dltech/atlas-core'

import type { Compaction, ECompactScope } from '../composition/compact-turn'

export abstract class CompactionPort {
  abstract compact(args: {
    threadId: ThreadId
    scope?: ECompactScope | undefined
    signal?: AbortSignal | undefined
  }): Promise<Compaction>

  abstract summarise(args: {
    threadId: ThreadId
    anchor: ECompactionAnchor
    seq: number
    signal?: AbortSignal | undefined
  }): Promise<Compaction>
}

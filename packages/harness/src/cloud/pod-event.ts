import type { Event } from '@dltech/atlas-core'
import type { PodEvent } from '@dltech/atlas-wire'

import { wireDraftOf } from './session-wire'

export function podEventOf(event: Event): PodEvent {
  const { id: _id, seq, threadId: _thread, runId, parentRunId, depth, at, ...draft } = event
  const wire = wireDraftOf(draft)
  return {
    seq,
    runId,
    depth,
    at,
    type: wire.type,
    body: wire.body,
    ...(parentRunId === undefined ? {} : { parentRunId }),
    ...(wire.contextSlot === undefined ? {} : { contextSlot: wire.contextSlot }),
    ...(wire.contextKey === undefined ? {} : { contextKey: wire.contextKey }),
    ...(wire.contextDigest === undefined ? {} : { contextDigest: wire.contextDigest }),
  }
}

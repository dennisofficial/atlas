import type { ParkedTranscriptRecord } from '../../cloud/transcript-freshness'

import type { ThreadMeta } from './meta'

export function parkedTranscriptOf(meta: ThreadMeta): ParkedTranscriptRecord | null {
  const stored = meta.parkedTranscript
  if (stored === undefined || stored === null) return null
  return { checkpoint: stored.checkpoint, applied: stored.applied ?? null }
}

export function metaWithParkedTranscript(args: {
  meta: ThreadMeta
  record: ParkedTranscriptRecord
}): ThreadMeta {
  return {
    ...args.meta,
    parkedTranscript: { checkpoint: args.record.checkpoint, applied: args.record.applied },
  }
}

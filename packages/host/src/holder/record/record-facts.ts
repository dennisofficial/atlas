import type { FactRecord } from '@dltech/atlas-core'

import type { RecordCache } from './record-cache'

export const factsOfKindIn = (args: { cache: RecordCache; kind: string }): readonly FactRecord[] =>
  args.cache.eventsAfter(0).flatMap((event) => {
    if (event.type !== 'fact-recorded' || event.kind !== args.kind) return []
    const resolved = args.cache.resolvedEvent(event)
    return resolved.type === 'fact-recorded'
      ? [
          {
            type: 'fact-recorded' as const,
            key: resolved.key,
            kind: resolved.kind,
            value: resolved.value,
          },
        ]
      : []
  })

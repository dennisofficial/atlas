import type { FactRecord } from '@dltech/atlas-core'

import type { RecordCache } from './record-cache'

export type FactCache = Pick<RecordCache, 'eventsAfter' | 'resolvedEvent'>

export const factsOfKindsIn = (args: {
  cache: FactCache
  kinds: ReadonlySet<string>
}): readonly FactRecord[] =>
  args.cache.eventsAfter(0).flatMap((event) => {
    if (event.type !== 'fact-recorded' || !args.kinds.has(event.kind)) return []
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

export const factsOfKindIn = (args: { cache: FactCache; kind: string }): readonly FactRecord[] =>
  factsOfKindsIn({ cache: args.cache, kinds: new Set([args.kind]) })

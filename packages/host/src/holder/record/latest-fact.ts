import type { SessionRecord } from './record-adapter'

export const holdsLatestFact = (args: {
  record: Pick<SessionRecord, 'eventCache'>
  draft: { type: string; key?: string; value?: unknown }
}): boolean => {
  const { draft } = args
  if (draft.type !== 'fact-recorded' || draft.key === undefined) return false
  const latest = args.record
    .eventCache()
    .bookkeeping()
    .factsWithPrefix(draft.key)
    .findLast((fact) => fact.key === draft.key)
  if (latest === undefined) return false
  return JSON.stringify(latest.value) === JSON.stringify(draft.value)
}

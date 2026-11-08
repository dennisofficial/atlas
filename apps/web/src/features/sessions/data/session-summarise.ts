import { summaryPointsOf, type SummariseReach, type V2Event } from '@dltech/atlas-core'
import type { SessionCommandInput, SessionCommandOutput } from '@dltech/atlas-protocol'

import type { SummariseCopy } from '@/features/threads/data/summarise'

export type SummariseApi = {
  command(input: SessionCommandInput): Promise<SessionCommandOutput>
}

export type PendingSummarise = { inboxId: number; afterSeq: number }

export enum ESummariseOutcome {
  Waiting = 'waiting',
  Refused = 'refused',
  Applied = 'applied',
}

export type SummariseOutcome =
  | { kind: ESummariseOutcome.Waiting }
  | { kind: ESummariseOutcome.Refused; reason: string }
  | { kind: ESummariseOutcome.Applied }

export const summarisePointsOf = (
  events: readonly V2Event[],
): ReadonlyMap<string, SummariseReach> => summaryPointsOf(events)

export const summariseCopyOf = (pick: SummariseReach): SummariseCopy => ({
  title: 'Summarise everything before this message?',
  description: `The ${pick.messages} earlier ${pick.messages === 1 ? 'message' : 'messages'} and every reply become one summary. Rewinding to before the summary brings them back. Files are left as they are.`,
})

export const summariseOutcomeOf = ({
  events,
  pending,
}: {
  events: readonly V2Event[]
  pending: PendingSummarise
}): SummariseOutcome => {
  const refused = events.find(
    (event) => event.type === 'input-refused' && event.inboxId === pending.inboxId,
  )
  if (refused?.type === 'input-refused') {
    return { kind: ESummariseOutcome.Refused, reason: refused.reason }
  }
  const applied = events.some(
    (event) => event.type === 'history-summarised' && event.seq > pending.afterSeq,
  )
  return applied ? { kind: ESummariseOutcome.Applied } : { kind: ESummariseOutcome.Waiting }
}

export const requestSummarise = async ({
  api,
  sessionId,
  throughSeq,
  events,
}: {
  api: SummariseApi
  sessionId: string
  throughSeq: number
  events: readonly V2Event[]
}): Promise<PendingSummarise> => {
  const { inboxId } = await api.command({ sessionId, name: 'summarise', args: { throughSeq } })
  if (inboxId === undefined) throw new Error('summarise was not queued')
  return { inboxId, afterSeq: events.at(-1)?.seq ?? 0 }
}

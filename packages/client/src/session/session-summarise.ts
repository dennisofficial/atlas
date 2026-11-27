import { summaryPointsOf, type SummariseReach, type RecordEvent } from '@dltech/atlas-core'
import type { SessionCommandInput, SessionCommandOutput } from '@dltech/atlas-protocol'

export type SummariseApi = {
  command(input: SessionCommandInput): Promise<SessionCommandOutput>
}

export type SummariseCopy = { title: string; description: string }

export const summarisePointsOf = (
  events: readonly RecordEvent[],
): ReadonlyMap<string, SummariseReach> => summaryPointsOf(events)

export const summariseCopyOf = (pick: SummariseReach): SummariseCopy => ({
  title: 'Summarise everything before this message?',
  description: `The ${pick.messages} earlier ${pick.messages === 1 ? 'message' : 'messages'} and every reply become one summary. Rewinding to before the summary brings them back. Files are left as they are.`,
})

export const requestSummarise = async ({
  api,
  sessionId,
  throughSeq,
}: {
  api: SummariseApi
  sessionId: string
  throughSeq: number
}): Promise<number> => {
  const { inboxId } = await api.command({ sessionId, name: 'summarise', args: { throughSeq } })
  if (inboxId === undefined) throw new Error('summarise was not queued')
  return inboxId
}

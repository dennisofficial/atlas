import type { V2Event } from '@dltech/atlas-core'
import type { SessionCommandInput, SessionCommandOutput } from '@dltech/atlas-protocol'

export type RewindApi = {
  command(input: SessionCommandInput): Promise<SessionCommandOutput>
}

export const seqByEventIdOf = (events: readonly V2Event[]): ReadonlyMap<string, number> =>
  new Map(events.flatMap((event) => (event.type === 'user-said' ? [[event.id, event.seq]] : [])))

export const requestRewind = async ({
  api,
  sessionId,
  toSeq,
}: {
  api: RewindApi
  sessionId: string
  toSeq: number
}): Promise<number> => {
  const { inboxId } = await api.command({ sessionId, name: 'rewind', args: { toSeq } })
  if (inboxId === undefined) throw new Error('rewind was not queued')
  return inboxId
}

export const rewoundDraftOf = (events: readonly V2Event[]): string | undefined => {
  const last = events.at(-1)
  return last?.type === 'history-rewound' ? last.draft : undefined
}

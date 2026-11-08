import type { ApiClient } from '@dltech/atlas-api-router'
import type { WireEvent } from '@dltech/atlas-wire/web'

export const headSeqOf = (events: readonly WireEvent[]): number =>
  events.reduce((head, event) => Math.max(head, event.seq), 0)

export const readEvents = async (args: {
  api: ApiClient
  threadId: string
  fromSeq?: number
}): Promise<WireEvent[]> =>
  args.api.threadEvents.read.query({
    threadId: args.threadId,
    own: true,
    ...(args.fromSeq === undefined ? {} : { fromSeq: args.fromSeq }),
  })

export const mergeEvents = (args: {
  current: readonly WireEvent[]
  incoming: readonly WireEvent[]
}): WireEvent[] => {
  if (args.incoming.length === 0) return args.current as WireEvent[]
  const bySeq = new Map<number, WireEvent>()
  for (const event of args.current) bySeq.set(event.seq, event)
  for (const event of args.incoming) bySeq.set(event.seq, event)
  return [...bySeq.values()].sort((left, right) => left.seq - right.seq)
}

export const appendedSeqOf = (args: {
  current: readonly WireEvent[]
  incoming: readonly WireEvent[]
}): number => {
  const held = new Set(args.current.map((event) => event.seq))
  return args.incoming.filter((event) => !held.has(event.seq)).length
}

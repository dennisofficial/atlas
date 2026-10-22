import type { WireEvent } from '@dltech/atlas-wire/web'

const bySeq = (left: WireEvent, right: WireEvent): number => left.seq - right.seq

export const headOf = (events: readonly WireEvent[]): number =>
  events.reduce((head, event) => Math.max(head, event.seq), 0)

export function appendEvents(args: {
  current: WireEvent[]
  incoming: readonly WireEvent[]
}): WireEvent[] {
  if (args.incoming.length === 0) return args.current
  const bySeqNumber = new Map<number, WireEvent>()
  for (const event of args.current) bySeqNumber.set(event.seq, event)
  for (const event of args.incoming) bySeqNumber.set(event.seq, event)
  return [...bySeqNumber.values()].sort(bySeq)
}

export const keepThrough = (args: { events: WireEvent[]; seq: number }): WireEvent[] =>
  args.events.filter((event) => event.seq <= args.seq)

import { chainHash, type LogHead } from './chain'
import type { Hash, V2Event } from './event'
import type { Lease } from './lease'

export type AppendRefusal =
  | { kind: 'stale-epoch'; current: number }
  | { kind: 'seq-mismatch'; expected: number }
  | { kind: 'hash-mismatch'; atSeq: number }
  | { kind: 'malformed'; atSeq: number; issue: string }

export type AppendResult =
  | { ok: true; head: LogHead; hashes: Hash[] }
  | { ok: false; refusal: AppendRefusal }

const refuse = (refusal: AppendRefusal): AppendResult => ({ ok: false, refusal })

export function acceptAppend(params: {
  head: LogHead
  lease: Lease
  epoch: number
  events: readonly V2Event[]
}): AppendResult {
  const { head, lease, events } = params
  const fenced =
    lease.holderHostId !== null &&
    params.epoch === lease.epoch &&
    events.every((event) => event.epoch === lease.epoch)
  if (!fenced) return refuse({ kind: 'stale-epoch', current: lease.epoch })
  if (events.length === 0) {
    return refuse({ kind: 'malformed', atSeq: head.seq + 1, issue: 'empty batch' })
  }

  let expected = head.seq + 1
  for (const event of events) {
    if (event.seq !== expected) return refuse({ kind: 'seq-mismatch', expected })
    expected += 1
  }

  let tip = head
  const hashes: Hash[] = []
  for (const event of events) {
    if (event.prevHash !== tip.hash) return refuse({ kind: 'hash-mismatch', atSeq: event.seq })
    const hash = chainHash(event)
    hashes.push(hash)
    tip = { seq: event.seq, hash }
  }
  return { ok: true, head: tip, hashes }
}

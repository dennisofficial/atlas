import { sha256Hex } from '../events/event-identity'
import { canonicalJson } from './canonical'
import type { Hash, RecordEvent } from './event'

export const GENESIS_HASH = '0'.repeat(64) as Hash

export type LogHead = { seq: number; hash: Hash }

export type SuffixVerification =
  | { ok: true; head: LogHead }
  | { ok: false; atSeq: number; reason: 'seq-mismatch' | 'hash-mismatch' }

export const chainHash = (event: RecordEvent): Hash =>
  sha256Hex(new TextEncoder().encode(canonicalJson(event))) as Hash

export function verifySuffix(params: {
  trusted: LogHead
  events: readonly RecordEvent[]
}): SuffixVerification {
  let head = params.trusted
  for (const event of params.events) {
    if (event.seq !== head.seq + 1) return { ok: false, atSeq: event.seq, reason: 'seq-mismatch' }
    if (event.prevHash !== head.hash)
      return { ok: false, atSeq: event.seq, reason: 'hash-mismatch' }
    head = { seq: event.seq, hash: chainHash(event) }
  }
  return { ok: true, head }
}

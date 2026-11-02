import { sha256Hex } from '../events/event-identity'
import { canonicalJson } from './canonical'
import type { Hash, V2Event } from './event'

export const GENESIS_HASH = '0'.repeat(64) as Hash

export type LogHead = { seq: number; hash: Hash }

export type SuffixVerification =
  | { ok: true; head: LogHead }
  | { ok: false; atSeq: number; reason: 'seq-mismatch' | 'hash-mismatch' }

export const canonicalEvent = (event: V2Event): string => canonicalJson(event)

export const chainHash = (event: V2Event): Hash =>
  sha256Hex(new TextEncoder().encode(canonicalEvent(event))) as Hash

export function verifySuffix(params: {
  trusted: LogHead
  events: readonly V2Event[]
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

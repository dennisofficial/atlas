import { transcriptIdentityDigest, type EventIdentity } from './event-identity'

export type PrefixDigest = (upTo: number) => Promise<{ count: number; digest: string }>

export function prefixDigestOf(args: {
  events: readonly EventIdentity[]
  upTo: number
}): string {
  return transcriptIdentityDigest(args.events.filter((event) => event.seq <= args.upTo))
}

export async function findDivergence(args: {
  local: readonly EventIdentity[]
  remoteDigest: PrefixDigest
}): Promise<number | null> {
  const head = args.local.reduce((max, event) => Math.max(max, event.seq), 0)

  if (head === 0) {
    const remoteAll = await args.remoteDigest(Number.MAX_SAFE_INTEGER)
    return remoteAll.count === 0 ? null : 1
  }

  const remoteHead = await args.remoteDigest(head)
  if (remoteHead.count < head) {
    return remoteHead.count + 1
  }

  const headDigest = prefixDigestOf({ events: args.local, upTo: head })
  if (headDigest === remoteHead.digest) {
    return null
  }

  let low = 1
  let high = head
  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    const probe = await args.remoteDigest(mid)
    const matchesPrefix =
      probe.count >= mid && probe.digest === prefixDigestOf({ events: args.local, upTo: mid })
    if (matchesPrefix) {
      low = mid + 1
    } else {
      high = mid
    }
  }
  return low
}

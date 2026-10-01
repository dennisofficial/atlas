import { createHash } from 'node:crypto'

import type { Event } from '@dltech/atlas-core'

const identityOf = (event: Event): readonly [string, number, string] => [
  event.id,
  event.seq,
  event.type,
]

export const transcriptIdentityDigest = (events: readonly Event[]): string => {
  const identities = events.map(identityOf).sort((a, b) => a[1] - b[1])
  return createHash('sha256').update(JSON.stringify(identities)).digest('hex')
}

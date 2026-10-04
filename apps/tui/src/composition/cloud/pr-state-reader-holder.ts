import type { RemotePrStateReader } from '@dltech/atlas-harness'

/**
 * The github surface is built once at compose time, but the cloud channel — and so the reader that
 * serves a cloud thread's pull request states — exists only once a cloud conversation is bound. The
 * holder bridges that: the conversation's runtime binding publishes its reader here, and the surface
 * reads whichever reader is current at render time. A local conversation clears it, so a local
 * thread never renders a stale remote set.
 */
let current: RemotePrStateReader | null = null

export const publishPrStateReader = (reader: RemotePrStateReader | null): void => {
  current = reader
}

export const activePrStateReader = (): RemotePrStateReader | null => current

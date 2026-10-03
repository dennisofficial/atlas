import type { ThreadId } from '@dltech/atlas-core'
import {
  ECloudFreshness,
  EParkedResume,
  parkedResumeOf,
  type ThreadStorePort,
} from '@dltech/atlas-harness'

import { sameIdentity } from '../thread-view-refresh'
import type { ThreadIdentity } from '../thread-reads'

export const parkedFreshnessOf = (resume: EParkedResume): ECloudFreshness => {
  if (resume === EParkedResume.Synced) return ECloudFreshness.Synced
  if (resume === EParkedResume.Behind) return ECloudFreshness.Behind
  return ECloudFreshness.Unknown
}

/**
 * What this machine's last sight of the park says about the local transcript, checked against the
 * transcript actually on disk now: a record that vouches for an identity the local file no longer
 * has cannot make the open Synced. A store that cannot answer reads as no record — the eager path.
 */
export async function readParkedResume(args: {
  threads: Pick<ThreadStorePort, 'readParkedTranscript'>
  threadId: ThreadId
  identity: ThreadIdentity | undefined
}): Promise<EParkedResume> {
  const record = await args.threads.readParkedTranscript({ threadId: args.threadId }).catch(() => null)
  const resume = parkedResumeOf({ record })
  if (resume !== EParkedResume.Synced) return resume

  const vouched = record?.applied ?? undefined
  return sameIdentity({ left: vouched, right: args.identity }) ? EParkedResume.Synced : EParkedResume.Behind
}

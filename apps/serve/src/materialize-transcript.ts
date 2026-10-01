import { type ThreadId } from '@dltech/atlas-core'

import { applyTranscriptArchive } from './transcript-bootstrap'
import type { FetchTranscriptArchive } from './workspace-spec'

export type TranscriptReadiness = { restored: boolean; fresh: boolean; failed: string | null }

export async function materializeTranscript(args: {
  fetchArchive: FetchTranscriptArchive
  atlasHome: string
  threadId: ThreadId
}): Promise<TranscriptReadiness> {
  const outcome = await applyTranscriptArchive({ ...args, explicit: false })
  return { restored: outcome.applied, fresh: outcome.fresh, failed: outcome.failed }
}

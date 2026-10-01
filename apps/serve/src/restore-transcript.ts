import type { EventLogPort, ThreadId } from '@dltech/atlas-core'

import { applyTranscriptArchive } from './transcript-bootstrap'
import type { FetchTranscriptArchive } from './workspace-spec'

export type TranscriptRestore = {
  restored: boolean
  failed: string | null
}

export async function restoreTranscript(args: {
  fetchArchive: FetchTranscriptArchive
  atlasHome: string
  threadId: ThreadId
  log: Pick<EventLogPort, 'refresh'>
  refuseIfBusy?: (() => string | null) | undefined
}): Promise<TranscriptRestore> {
  const outcome = await applyTranscriptArchive({ ...args, explicit: true })
  if (outcome.failed !== null) return { restored: false, failed: outcome.failed }

  await args.log.refresh({ threadId: args.threadId })
  return { restored: true, failed: null }
}

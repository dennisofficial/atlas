import {
  EExecutionLocation,
  type EventLogPort,
  type IdPort,
  type ThreadId,
} from '@dltech/atlas-core'

import type { RestoreTranscriptParams } from '@dltech/atlas-wire'

import { applyTranscriptArchive } from './transcript-bootstrap'
import type { FetchTranscriptArchive } from './workspace-spec'

export type TranscriptRestore = {
  restored: boolean
  failed: string | null
}

type LocationChangedDraft = NonNullable<RestoreTranscriptParams['locationChanged']>

const toLocation = (value: LocationChangedDraft['from']): EExecutionLocation => {
  if (value === 'docker') return EExecutionLocation.Docker
  if (value === 'cloud') return EExecutionLocation.Cloud
  return EExecutionLocation.Host
}

/**
 * The lift ships its `location-changed → cloud` draft on the restore op so the marker pins on the
 * sandbox's own log — the transcript the operator reads while lifted — rather than only on the
 * local log the archive already sealed. Idempotent: a re-restore of the same tar must not pin a
 * second marker, so a log whose latest move already lands at the same location is left alone — the
 * workspace arrival can follow its marker with directory and context events, so the marker is not
 * necessarily the literal tail. A failed append never fails the restore — the transcript is
 * already home; the marker is the telling, not the move.
 */
async function pinLocationMarker(args: {
  log: Pick<EventLogPort, 'readOwn' | 'append'>
  ids: Pick<IdPort, 'nextRunId'>
  threadId: ThreadId
  draft: LocationChangedDraft
}): Promise<void> {
  const existing = await args.log.readOwn({ threadId: args.threadId })
  const lastMove = existing.findLast((event) => event.type === 'location-changed')
  if (lastMove?.type === 'location-changed' && lastMove.to === toLocation(args.draft.to)) return
  await args.log
    .append({
      threadId: args.threadId,
      runId: args.ids.nextRunId(),
      drafts: [
        {
          type: 'location-changed',
          from: toLocation(args.draft.from),
          to: toLocation(args.draft.to),
          ...(args.draft.cwd === undefined ? {} : { cwd: args.draft.cwd }),
          ...(args.draft.remoteUrl === undefined ? {} : { remoteUrl: args.draft.remoteUrl }),
          ...(args.draft.branch === undefined ? {} : { branch: args.draft.branch }),
        },
      ],
    })
    .catch(() => undefined)
}

export async function restoreTranscript(args: {
  fetchArchive: FetchTranscriptArchive
  atlasHome: string
  threadId: ThreadId
  log: Pick<EventLogPort, 'refresh' | 'readOwn' | 'append'>
  ids: Pick<IdPort, 'nextRunId'>
  marker?: LocationChangedDraft | undefined
  refuseIfBusy?: (() => string | null) | undefined
}): Promise<TranscriptRestore> {
  const outcome = await applyTranscriptArchive({
    fetchArchive: args.fetchArchive,
    atlasHome: args.atlasHome,
    threadId: args.threadId,
    explicit: true,
    ...(args.refuseIfBusy === undefined ? {} : { refuseIfBusy: args.refuseIfBusy }),
  })
  if (outcome.failed !== null) return { restored: false, failed: outcome.failed }

  await args.log.refresh({ threadId: args.threadId })
  if (args.marker !== undefined) {
    await pinLocationMarker({ log: args.log, ids: args.ids, threadId: args.threadId, draft: args.marker })
  }
  return { restored: true, failed: null }
}

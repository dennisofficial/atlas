import type { ThreadId } from '@dltech/atlas-core'
import type { RestoreTranscriptParams } from '@dltech/atlas-wire'

import { settleDirectArrival } from './direct-arrival'
import type { DirectWorkspace } from './direct-workspace'
import { driveTranscriptArchiveFetcher } from './drive-bootstrap'
import { hydrateCloudPlacement } from './placement-hydration'
import { restoreTranscript } from './restore-transcript'
import { adoptChildrenInBackground } from './serve-background'
import type { ServeApp } from './serve-app'
import { EServeEvent, type ServeLog } from './serve-log'
import { transcriptBootstrapReceipt } from './transcript-bootstrap'
import type { FetchTranscriptArchive } from './workspace-spec'

export function createTranscriptRestorer(args: {
  app: ServeApp
  threadId: ThreadId
  driveHome: string
  direct: DirectWorkspace
  activeCwd: string
  log: ServeLog
  settling: { count: number }
  dormant: () => boolean
  note: () => void
  fetchTranscriptArchive?: FetchTranscriptArchive | undefined
}) {
  const { app, threadId, driveHome, direct, log } = args
  return async (marker?: RestoreTranscriptParams['locationChanged']) => {
    const fetchArchive = args.fetchTranscriptArchive ?? driveTranscriptArchiveFetcher({ driveHome })
    const receiptBefore = await transcriptBootstrapReceipt({ atlasHome: driveHome })
    const arriving = await direct.receipt()
    const arrivalPending = arriving?.arrivalPending === true
    const result = await restoreTranscript({
      fetchArchive,
      atlasHome: driveHome,
      threadId,
      log: app.log,
      ids: app.ids,
      ...(marker === undefined || arrivalPending ? {} : { marker }),
      refuseIfBusy: () =>
        args.settling.count > 0
          ? 'transferred children are still resuming, so the transcript cannot be replaced'
          : null,
    })
    if (result.failed !== null) log({ event: EServeEvent.TranscriptFailed, reason: result.failed })
    else if (result.restored) log({ event: EServeEvent.TranscriptRestored })
    if (!result.restored) return result
    await hydrateCloudPlacement({ app, threadId })
    if (arrivalPending && arriving !== null) {
      await settleDirectArrival({
        direct,
        app,
        threadId,
        restored: arriving.restored,
        launchDirectory: direct.activeCwd() ?? args.activeCwd,
        from: marker?.from,
        to: marker?.to,
      })
    }
    const receiptAfter = await transcriptBootstrapReceipt({ atlasHome: driveHome })
    if (receiptAfter !== receiptBefore || receiptAfter === null) {
      const restoredThread = await app.threads.find({ threadId })
      if (app.modelBridge !== undefined && restoredThread?.model !== undefined) {
        app.modelBridge.select({
          ref: restoredThread.model.ref,
          effort: restoredThread.model.effort ?? app.modelBridge.effort(),
        })
      }
      if (!args.dormant()) {
        adoptChildrenInBackground({
          app,
          threadId,
          log,
          settling: args.settling,
          note: args.note,
        })
      }
    }
    return result
  }
}

import { atlasDirectory, type CloudChannel, type RuntimeCheckpoint } from '@dltech/atlas-harness'
import type { ThreadId } from '@dltech/atlas-core'

import type { AtlasApp } from '../compose'
import { cloudReadinessOf } from './cloud-readiness'
import { localTranscriptFiles, type TranscriptFiles } from './local-transcript-files'
import { createParkPersistence } from './park-persistence'

/**
 * What a cloud session does when its sandbox parks: persist the checkpoint together with the
 * applied transcript so the next open of this thread can render from disk. The local stores are
 * the app's own — never the channel-backed ones the binding reads through.
 */
export function parkHookFor(args: {
  app: Pick<AtlasApp, 'threads' | 'log'>
  channel: Pick<CloudChannel, 'threadId'>
  threadId?: ThreadId | undefined
  files?: TranscriptFiles | undefined
  /** The binding's mirrored log converging one last time; absent, the local file is all there is. */
  converge?: (() => Promise<void>) | undefined
}): (checkpoint: RuntimeCheckpoint) => void {
  const readiness = cloudReadinessOf(args.channel)
  const threadId = args.threadId ?? args.channel.threadId
  const parking = createParkPersistence({
    threadId,
    threads: args.app.threads,
    files: args.files ?? localTranscriptFiles({ home: atlasDirectory }),
    applied: () => readiness.applied(),
    waitUntilApplied: (identity) => readiness.waitUntilApplied(identity),
    refreshLog: () => args.app.log.refresh({ threadId }),
    readLog: () => args.app.log.read({ threadId }),
    ...(args.converge === undefined ? {} : { converge: args.converge }),
  })
  return (checkpoint) => {
    void parking.persist(checkpoint)
  }
}

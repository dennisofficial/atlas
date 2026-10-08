import type { ThreadId } from '@dltech/atlas-core'
import {
  EArchivePhase,
  EDescendNode,
  type ArchiveProgressSignal,
  type ChannelListener,
  type RelocationTransferProgress,
  type Unsubscribe,
} from '@dltech/atlas-harness'

const DESCEND_NODE: Record<ArchiveProgressSignal['archive'], EDescendNode> = {
  transcript: EDescendNode.ArchiveRemote,
  workspace: EDescendNode.PrepareWorkspace,
}

const PHASE_VERB: Record<EArchivePhase, string> = {
  [EArchivePhase.Walking]: 'scanning',
  [EArchivePhase.Staging]: 'packing',
  [EArchivePhase.Compressing]: 'compressing',
}

export const archiveBuildTransfer = (signal: ArchiveProgressSignal): RelocationTransferProgress => ({
  nodeId: DESCEND_NODE[signal.archive],
  transferId: `archive-build-${signal.archive}`,
  label: `${PHASE_VERB[signal.phase]} the ${signal.archive}`,
  transferredBytes: signal.bytes,
  totalBytes: signal.totalBytes,
  complete: false,
})

export function followArchiveBuild(args: {
  channel: { subscribe(args: { threadId: ThreadId; listener: ChannelListener }): Unsubscribe }
  threadId: ThreadId
  onProgress: (progress: RelocationTransferProgress) => void
}): Unsubscribe {
  return args.channel.subscribe({
    threadId: args.threadId,
    listener: (signal) => {
      if (signal.type !== 'archive-progress') return
      args.onProgress(archiveBuildTransfer(signal))
    },
  })
}

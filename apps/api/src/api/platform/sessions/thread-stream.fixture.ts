import { EPodState, EThreadStreamFrame, type PodStatus } from '@dltech/atlas-wire'
import type { ThreadMetadataFrame } from './thread-stream-state'
import type { ThreadPodSnapshot } from './pod-snapshot'

export const podSnapshotFrame = (
  args: { rev?: number; state?: EPodState } = {},
): ThreadPodSnapshot => ({
  type: EThreadStreamFrame.Pod,
  status: { state: args.state ?? EPodState.None, steps: [], history: [], rev: args.rev ?? 0 },
  rev: args.rev ?? 0,
})

export const emptyPodStatus: PodStatus = { state: EPodState.None, steps: [], history: [] }

export const metadataFrame = (args: { threadId: string; rev?: number }): ThreadMetadataFrame => ({
  type: EThreadStreamFrame.Meta,
  rev: args.rev ?? 0,
  thread: {
    id: args.threadId,
    head: 7,
    createdAt: '2026-09-15T00:00:00.000Z',
    updatedAt: '2026-09-15T00:00:00.000Z',
    workspace: null,
    repo: null,
  },
})

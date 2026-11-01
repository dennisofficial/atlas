import { ERunner } from '@dltech/atlas-core'
import { EPodState, type PodStatus, type WireThread } from '@dltech/atlas-wire/web'

import type { SessionNode as WireSessionNode } from '@/features/threads/data/threads-api'

import { ELocalPodState, type LocalPod } from './desktop-wire'

export function localThreadOf(pod: LocalPod): WireThread {
  const podState = POD_STATE[pod.state]
  return {
    id: pod.threadId,
    head: 0,
    createdAt: pod.createdAt,
    updatedAt: pod.createdAt,
    archivedAt: pod.archivedAt,
    workspace: null,
    repo: null,
    projectId: pod.projectId,
    runner: ERunner.Local,
    ...(podState === undefined
      ? {}
      : {
          status: {
            working: false,
            awaiting: null,
            lastOutcome: null,
            podState,
            lastAssistantSeq: 0,
            readSeq: null,
          },
        }),
    ...(pod.title === undefined ? {} : { title: pod.title }),
    ...(pod.model === undefined || pod.effort === undefined
      ? {}
      : { model: { ref: pod.model, effort: pod.effort } }),
  }
}

export const localSessionOf = (pod: LocalPod): WireSessionNode => ({
  id: `local_${pod.threadId}`,
  mainThread: localThreadOf(pod),
  teammates: [],
})

const POD_STATE: Record<ELocalPodState, EPodState> = {
  [ELocalPodState.Running]: EPodState.Running,
  [ELocalPodState.Stopped]: EPodState.Parked,
  [ELocalPodState.Missing]: EPodState.Failed,
}

export const podStatusOf = (pod: LocalPod): PodStatus => ({
  state: POD_STATE[pod.state],
  steps: [],
})

export function withLocalPods<
  T extends { project: { id: string } | null; sessions: WireSessionNode[] },
>(args: { entries: T[]; pods: readonly LocalPod[] }): T[] {
  if (args.pods.length === 0) return args.entries
  return args.entries.map((entry) => ({
    ...entry,
    sessions: [
      ...entry.sessions,
      ...args.pods.filter((pod) => pod.projectId === entry.project?.id).map(localSessionOf),
    ],
  }))
}

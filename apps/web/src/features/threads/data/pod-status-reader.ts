import { EPodState, type PodStatus } from '@dltech/atlas-wire/web'

import { createCoalescedRunner } from './coalesced-runner'

export function createPodStatusReader(args: {
  threadId: string
  fetchPod: (threadId: string) => Promise<PodStatus>
  onPod: (pod: PodStatus) => void
}) {
  let stopped = false
  let lastPodRev = -1
  let generation = 0
  let requestedGeneration = 0
  let current: PodStatus | undefined

  const publish = (pod: PodStatus) => {
    current = pod
    args.onPod(pod)
  }

  const runner = createCoalescedRunner({
    run: async () => {
      const mine = requestedGeneration
      if (mine !== generation) return
      try {
        const pod = await args.fetchPod(args.threadId)
        if (stopped || mine !== generation || (pod.rev !== undefined && pod.rev < lastPodRev))
          return
        if (pod.rev !== undefined) lastPodRev = pod.rev
        publish(pod)
      } catch {
        return
      }
    },
  })

  return {
    refresh: () => {
      if (stopped) return
      requestedGeneration = generation
      runner.trigger()
    },
    apply: ({ status, rev }: { status: PodStatus; rev?: number }) => {
      const revision = rev ?? status.rev
      if (stopped || (revision !== undefined && revision <= lastPodRev)) return
      if (revision !== undefined) lastPodRev = revision
      generation += 1
      const resources =
        status.resources === undefined &&
        status.state === EPodState.Running &&
        current?.state === EPodState.Running
          ? current.resources
          : status.resources
      publish(resources === undefined ? status : { ...status, resources })
    },
    stop: () => {
      stopped = true
      runner.stop()
    },
  }
}

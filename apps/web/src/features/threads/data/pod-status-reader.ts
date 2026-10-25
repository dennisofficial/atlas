import type { PodStatus } from '@dltech/atlas-wire/web'

import { createCoalescedRunner } from './coalesced-runner'

export function createPodStatusReader(args: {
  threadId: string
  fetchPod: (threadId: string) => Promise<PodStatus>
  onPod: (pod: PodStatus) => void
}) {
  let stopped = false

  const runner = createCoalescedRunner({
    run: async () => {
      try {
        const pod = await args.fetchPod(args.threadId)
        if (stopped) return
        args.onPod(pod)
      } catch {
        return
      }
    },
  })

  return {
    refresh: runner.trigger,
    stop: () => {
      stopped = true
      runner.stop()
    },
  }
}

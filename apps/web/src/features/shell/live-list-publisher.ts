import { EThreadLiveFrame } from '@dltech/atlas-wire/web'

import type { LocalPod } from '@/features/desktop/desktop-wire'
import { withLocalPods } from '@/features/desktop/local-thread'

import { entriesOf } from './live-list'
import type { AppliedLiveFrame } from './live-stream'
import type { ProjectThreads } from './thread-partition'

export function createLiveListPublisher(args: {
  loadPods: () => Promise<LocalPod[]>
  publish: (update: { applied: AppliedLiveFrame; entries: ProjectThreads[] }) => void
}) {
  let generation = 0
  let stopped = false
  let latest: AppliedLiveFrame | undefined
  let pods: LocalPod[] | undefined

  const publish = () => {
    if (stopped || latest === undefined || pods === undefined) return
    args.publish({
      applied: latest,
      entries: withLocalPods({ entries: entriesOf(latest.state), pods }),
    })
  }

  return {
    apply: (applied: AppliedLiveFrame) => {
      if (stopped) return
      latest = applied
      if (applied.frame.type !== EThreadLiveFrame.Snapshot) {
        publish()
        return
      }
      generation += 1
      const mine = generation
      pods = undefined
      void args.loadPods().then((loaded) => {
        if (stopped || generation !== mine) return
        pods = loaded
        publish()
      })
    },
    stop: () => {
      stopped = true
      generation += 1
    },
  }
}

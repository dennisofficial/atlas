import { entriesOf } from './live-list'
import type { AppliedLiveFrame } from './live-stream'
import type { ProjectThreads } from './thread-partition'

export function createLiveListPublisher(args: {
  publish: (update: { applied: AppliedLiveFrame; entries: ProjectThreads[] }) => void
}) {
  let stopped = false

  return {
    apply: (applied: AppliedLiveFrame) => {
      if (stopped) return
      args.publish({ applied, entries: entriesOf(applied.state) })
    },
    stop: () => {
      stopped = true
    },
  }
}

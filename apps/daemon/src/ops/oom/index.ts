import { type DaemonGroupFactory, type GroupContext, defineOp } from '@dltech/atlas-protocol/engine'

import type { DaemonOpsDeps } from '../deps'
import { oomRecorderOf } from './recorder'

export const oomGroup =
  (deps: DaemonOpsDeps): DaemonGroupFactory =>
  (groupCtx: GroupContext) => {
    const recorder = oomRecorderOf(deps)
    recorder.watchPod(groupCtx.publish)
    return {
      name: 'oom',
      ops: [
        defineOp({
          op: 'oom.list',
          run: () => Promise.resolve({ incidents: recorder.journal.list() }),
        }),
      ],
      stop: () => {
        recorder.stop()
        return Promise.resolve()
      },
    }
  }

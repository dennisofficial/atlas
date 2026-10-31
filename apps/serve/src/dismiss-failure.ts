import type { ThreadId } from '@dltech/atlas-core'
import { dismissRunFailure } from '@dltech/atlas-harness'

import type { ServeApp } from './serve-app'

export const dismissFailureFor =
  (args: { app: ServeApp; threadId: ThreadId }) =>
  ({ failureSeq }: { failureSeq: number }): Promise<void> =>
    dismissRunFailure({
      log: args.app.log,
      threadId: args.threadId,
      runId: args.app.ids.nextRunId(),
      failureSeq,
    })

import type { ViewChangeHook } from '@dltech/atlas-control'
import type { LogPort } from '@dltech/atlas-observability'
import { podResizeOnIdleHook } from '@dltech/atlas-pods'

import type { JobsProjectDispatcher } from '../../_core/ports/job-dispatcher'
import { podResizeTaskContract } from '../../_lib/pod-resize/pod-resize.contract'

const reasonOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

export const podResizeOnIdleOf = (args: {
  dispatcher: JobsProjectDispatcher
  log: LogPort
}): ViewChangeHook =>
  podResizeOnIdleHook({
    dispatch: async ({ payload, idempotencyKey }) => {
      await args.dispatcher.dispatch({
        task: podResizeTaskContract,
        payload,
        idempotencyKey,
      })
    },
    warn: ({ sessionId, failure }) => {
      args.log.warn({
        source: 'agent.host.pod-resize-on-idle',
        message: `dispatching the resize of idle session ${sessionId} failed`,
        error: reasonOf(failure),
      })
    },
  })

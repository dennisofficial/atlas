import type { ControlSessionRow, ViewChangeHook } from '@dltech/atlas-control'
import { podResizeResumeOf, podResizeWentIdle } from '@dltech/atlas-core'
import { podResizeIdempotencyKey, type PodResizePayload } from '@dltech/atlas-jobs/pod-resize'

import { podBusyFactsOfState } from './pod-busy'

export type PodResizeResumeDispatch = (args: {
  payload: PodResizePayload
  idempotencyKey: string
}) => Promise<unknown>

export const POD_RESIZE_ON_IDLE_HOOK = 'pod-resize-on-idle'

const resumePayloadOf = (args: {
  session: ControlSessionRow
  generation: number
  waitedSince: string
}): PodResizePayload | undefined => {
  const { session } = args
  if (session.podDesiredVcpus === null || session.podDesiredMemoryGb === null) return undefined
  return {
    sessionId: session.sessionId,
    generation: args.generation,
    vcpus: session.podDesiredVcpus,
    memoryGb: session.podDesiredMemoryGb,
    ...(session.podDesiredDiskGb === null ? {} : { diskGb: session.podDesiredDiskGb }),
    whenIdle: true,
    waitedSince: args.waitedSince,
  }
}

export const podResizeOnIdleHook = (args: {
  dispatch: PodResizeResumeDispatch
  warn(args: { sessionId: string; failure: unknown }): void
}): ViewChangeHook => ({
  name: POD_RESIZE_ON_IDLE_HOOK,
  handle: async ({ tx, sessionId, before, after, now }) => {
    const wentIdle = podResizeWentIdle({
      before: podBusyFactsOfState({ state: before, now }),
      after: podBusyFactsOfState({ state: after, now }),
    })
    if (!wentIdle) return
    const session = await tx.lockSession(sessionId)
    const resume = podResizeResumeOf({ wentIdle, session })
    if (resume === undefined || session === undefined) return
    const payload = resumePayloadOf({ session, ...resume })
    if (payload === undefined) return
    try {
      await args.dispatch({ payload, idempotencyKey: podResizeIdempotencyKey(payload) })
    } catch (failure) {
      args.warn({ sessionId, failure })
    }
  },
})

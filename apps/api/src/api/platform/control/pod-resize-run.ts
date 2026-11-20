import type { ControlSessionRow } from '@dltech/atlas-control'
import type { PodBusy } from '@dltech/atlas-core'

import type { PodResizeOutcome } from '../../../agent'
import {
  EPodResizeOutcome,
  type PodResizeOutput,
  type PodResizePayload,
} from './pod-resize.contract'

export type PodResizeSession = Pick<
  ControlSessionRow,
  'sessionId' | 'podSessionId' | 'podSizeGeneration' | 'podDesiredVcpus'
>

export type PodResizeDeps = {
  session(args: { sessionId: string }): Promise<PodResizeSession | undefined>
  resize(args: { sandboxSessionId: string; vcpus: number }): Promise<PodResizeOutcome>
  rewake(args: { sessionId: string }): Promise<unknown>
  held(args: { sessionId: string }): Promise<boolean>
  recordFailed(args: { sessionId: string; generation: number; error: string }): Promise<unknown>
  busy(args: { sessionId: string }): Promise<PodBusy>
  requeue(args: { payload: PodResizePayload; delaySeconds: number }): Promise<unknown>
}

export const NO_SANDBOX_TO_RESIZE = 'No sandbox to resize'

export const POD_RESIZE_WAIT_SECONDS = 30

export const failureText = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

export const runPodResize = async (args: {
  payload: PodResizePayload
  deps: PodResizeDeps
}): Promise<PodResizeOutput> => {
  const { payload, deps } = args
  const session = await deps.session({ sessionId: payload.sessionId })
  if (session === undefined || session.podSizeGeneration !== payload.generation) {
    return { outcome: EPodResizeOutcome.Superseded }
  }
  if (payload.whenIdle === true && (await deps.busy({ sessionId: payload.sessionId })).busy) {
    await deps.requeue({ payload, delaySeconds: POD_RESIZE_WAIT_SECONDS })
    return { outcome: EPodResizeOutcome.Waiting }
  }
  const vcpus = session.podDesiredVcpus ?? payload.vcpus
  const sandboxSessionId = session.podSessionId ?? session.sessionId
  const resized = await deps.resize({ sandboxSessionId, vcpus })
  if (resized === 'absent') {
    // nothing will ever apply this size: say so rather than claim it was stored
    await deps.recordFailed({
      sessionId: sandboxSessionId,
      generation: payload.generation,
      error: NO_SANDBOX_TO_RESIZE,
    })
    return { outcome: EPodResizeOutcome.Failed }
  }
  // a parked pod keeps the size for its next wake; waking it now would defeat the park
  if (resized === 'stored' && !(await deps.held({ sessionId: sandboxSessionId }))) {
    return { outcome: EPodResizeOutcome.Deferred }
  }
  // the restart stopped the pod: nothing else would wake it, so the applied size stays unrecorded
  await deps.rewake({ sessionId: sandboxSessionId })
  return { outcome: EPodResizeOutcome.Applied }
}

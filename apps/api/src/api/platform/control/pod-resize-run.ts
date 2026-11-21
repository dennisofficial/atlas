import type { ControlSessionRow } from '@dltech/atlas-control'
import type { PodBusy, PodShape } from '@dltech/atlas-core'

import type { PodResizeOutcome } from '../../../agent'
import {
  EPodResizeOutcome,
  type PodResizeOutput,
  type PodResizePayload,
} from './pod-resize.contract'

export type PodResizeSession = Pick<
  ControlSessionRow,
  | 'sessionId'
  | 'podSessionId'
  | 'podSizeGeneration'
  | 'podDesiredVcpus'
  | 'podDesiredMemoryGb'
  | 'podDesiredDiskGb'
>

export type PodResizeDeps = {
  session(args: { sessionId: string }): Promise<PodResizeSession | undefined>
  resize(args: {
    sandboxSessionId: string
    shape: PodShape
    diskGb?: number | undefined
  }): Promise<PodResizeOutcome>
  rewake(args: { sessionId: string }): Promise<unknown>
  held(args: { sessionId: string }): Promise<boolean>
  recordApplied(args: {
    sessionId: string
    vcpus: number
    memoryGb: number
    generation: number
  }): Promise<unknown>
  recordFailed(args: { sessionId: string; generation: number; error: string }): Promise<unknown>
  recordWaiting(args: { sessionId: string; generation: number }): Promise<unknown>
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
    await deps.recordWaiting({
      sessionId: payload.sessionId,
      generation: payload.generation,
    })
    await deps.requeue({ payload, delaySeconds: POD_RESIZE_WAIT_SECONDS })
    return { outcome: EPodResizeOutcome.Waiting }
  }
  const shape = {
    vcpus: session.podDesiredVcpus ?? payload.vcpus,
    memoryGb: session.podDesiredMemoryGb ?? payload.memoryGb,
  }
  const sandboxSessionId = session.podSessionId ?? session.sessionId
  const diskGb = session.podDesiredDiskGb ?? payload.diskGb
  const resized = await deps.resize({
    sandboxSessionId,
    shape,
    ...(diskGb === undefined ? {} : { diskGb }),
  })
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
  // A restart has already recreated the container at the new shape, so the size is applied before
  // anything wakes the pod again: the re-wake below can fail, be claimed elsewhere, or never report
  // the instance's cpu, and the generation this resize was asked for is known here either way.
  if (resized === 'restarted') {
    await deps.recordApplied({
      sessionId: sandboxSessionId,
      vcpus: shape.vcpus,
      memoryGb: shape.memoryGb,
      generation: payload.generation,
    })
  }
  // the restart stopped the pod: nothing else would wake it
  await deps.rewake({ sessionId: sandboxSessionId })
  return { outcome: EPodResizeOutcome.Applied }
}

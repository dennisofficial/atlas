import type { ControlSessionRow } from '@dltech/atlas-control'

import type { VercelCredentials } from '../../../agent/sandbox/constants'
import type { PodResizeOutcome } from '../../../agent/sandbox/sandbox-provider'
import {
  EPodResizeOutcome,
  type PodResizeOutput,
  type PodResizePayload,
} from './pod-resize.contract'

export type PodResizeSession = Pick<
  ControlSessionRow,
  'sessionId' | 'userId' | 'podSessionId' | 'podSizeGeneration' | 'podDesiredVcpus'
>

export type PodResizeDeps = {
  session(args: { sessionId: string }): Promise<PodResizeSession | undefined>
  credentials(args: { userId: string }): Promise<VercelCredentials>
  resize(args: {
    sandboxSessionId: string
    credentials: VercelCredentials
    vcpus: number
  }): Promise<PodResizeOutcome>
  rewake(args: { sessionId: string }): Promise<unknown>
  recordFailed(args: { sessionId: string; generation: number; error: string }): Promise<unknown>
}

const outcomeOf = (resized: PodResizeOutcome): EPodResizeOutcome =>
  resized === 'restarted' ? EPodResizeOutcome.Applied : EPodResizeOutcome.Stored

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
  const vcpus = session.podDesiredVcpus ?? payload.vcpus
  const sandboxSessionId = session.podSessionId ?? session.sessionId
  const credentials = await deps.credentials({ userId: session.userId })
  const resized = await deps.resize({ sandboxSessionId, credentials, vcpus })
  if (resized !== 'restarted') return { outcome: outcomeOf(resized) }
  // the restart stopped the pod: nothing else would wake it, so the applied size stays unrecorded
  await deps.rewake({ sessionId: sandboxSessionId })
  return { outcome: EPodResizeOutcome.Applied }
}

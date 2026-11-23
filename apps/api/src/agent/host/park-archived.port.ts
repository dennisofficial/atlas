import type { ControlSessionRow } from '@dltech/atlas-control'
import type { ParkArchivedPod } from '@dltech/atlas-host'
import type { LogPort } from '@dltech/atlas-observability'

import type { JobsProjectDispatcher } from '../../_core/ports/job-dispatcher'
import { podSleepIdempotencyKey, podSleepTaskContract } from '../../_lib/trigger/pod-sleep.contract'

export type ParkArchivedPlane = {
  readSession(args: {
    sessionId: string
  }): Promise<Pick<ControlSessionRow, 'sessionId' | 'podSessionId'> | undefined>
  podPeersPlaced(args: { podSessionId: string; excludeSessionId: string }): Promise<number>
  currentLease(args: { sessionId: string }): Promise<{ lease: { epoch: number } }>
}

const reasonOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

export const parkArchivedDispatchOf =
  (args: {
    plane: ParkArchivedPlane
    dispatcher: JobsProjectDispatcher
    log: LogPort
  }): ParkArchivedPod =>
  async ({ sessionId }) => {
    try {
      const session = await args.plane.readSession({ sessionId })
      if (session === undefined) return
      if ((session.podSessionId ?? session.sessionId) !== session.sessionId) return
      const peers = await args.plane.podPeersPlaced({
        podSessionId: session.sessionId,
        excludeSessionId: session.sessionId,
      })
      if (peers > 0) return
      const { lease } = await args.plane.currentLease({ sessionId })
      const payload = { sessionId, epoch: lease.epoch }
      await args.dispatcher.dispatch({
        task: podSleepTaskContract,
        payload,
        idempotencyKey: podSleepIdempotencyKey(payload),
      })
    } catch (failure) {
      args.log.warn({
        source: 'agent.host.park-archived',
        message: `parking the pod of archived session ${sessionId} failed`,
        error: reasonOf(failure),
      })
    }
  }

import type { ControlPlane } from '@dltech/atlas-control'
import { db } from '@dltech/atlas-db'
import { podBusyFactsOf, podResizeBusyOf, type PodBusy } from '@dltech/atlas-core'
import {
  POD_RESIZE_TASK_ID,
  podResizeIdempotencyKey,
  podResizePayloadSchema,
  type PodResizePayload,
} from '@dltech/atlas-jobs/pod-resize'
import {
  failureText,
  jobsControlPlaneOf,
  podResizerOf,
  readPodResizeBusy,
  readPodsEnv,
  type PodResizeDeps,
} from '@dltech/atlas-pods'
import { idempotencyKeys, tasks } from '@trigger.dev/sdk'
import { triggerLog } from '../trigger-logger'

export type PodResizeGraph = { deps: PodResizeDeps }

export const requeuePodResize = async (args: {
  payload: PodResizePayload
  delaySeconds: number
}): Promise<PodResizePayload> => {
  const payload = podResizePayloadSchema.parse({
    ...args.payload,
    waits: (args.payload.waits ?? 0) + 1,
  })
  await tasks.trigger(POD_RESIZE_TASK_ID, payload, {
    idempotencyKey: await idempotencyKeys.create(podResizeIdempotencyKey(payload), {
      scope: 'global',
    }),
    delay: `${args.delaySeconds}s`,
  })
  return payload
}

const busyOf = async (args: { plane: ControlPlane; sessionId: string }): Promise<PodBusy> => {
  const session = await args.plane.readSession({ sessionId: args.sessionId })
  if (session === undefined)
    return podResizeBusyOf(
      podBusyFactsOf({ state: undefined, shellsRunning: 0, servicesRunning: 0 }),
    )
  return await readPodResizeBusy({ plane: args.plane, session })
}

export function buildPodResizeGraph(): PodResizeGraph {
  const env = readPodsEnv()
  const plane = jobsControlPlaneOf({ db })
  const resizer = podResizerOf({ env, db })
  return {
    deps: {
      session: (args) => plane.readSession(args),
      resize: (args) => resizer.resize(args),
      rewake: async (args) => {
        await plane.revoke({ sessionId: args.sessionId, wantsHolder: true })
        triggerLog.log(`rewaking ${args.sessionId} at its new size`)
      },
      held: async (args) => (await plane.currentLease(args)).live,
      recordApplied: async (args) => {
        try {
          const recorded = await plane.recordPodApplied(args)
          triggerLog.log(
            `pod-resize applied ${args.vcpus} vCPU / ${args.memoryGb} GB as generation ${args.generation} for ${args.sessionId}${
              recorded ? '' : ' (a newer resize superseded it)'
            }`,
          )
        } catch (error) {
          triggerLog.warn(
            `recording the applied pod size for ${args.sessionId} failed: ${failureText(error)}`,
          )
        }
      },
      recordFailed: async (args) => {
        await plane.recordPodFailed(args)
        triggerLog.warn(`pod-resize for ${args.sessionId} failed: ${args.error}`)
      },
      recordWaiting: async (args) => {
        await plane.recordPodWaiting({ ...args, since: new Date().toISOString() })
        triggerLog.log(`pod-resize for ${args.sessionId} waits for the pod to go idle`)
      },
      busy: (args) => busyOf({ plane, sessionId: args.sessionId }),
      requeue: async (args) => {
        const payload = await requeuePodResize(args)
        triggerLog.log(`pod-resize for ${payload.sessionId} waits ${args.delaySeconds}s for idle`)
      },
    },
  }
}

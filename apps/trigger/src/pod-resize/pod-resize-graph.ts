import type { ControlPlane } from '@dltech/atlas-control'
import { db } from '@dltech/atlas-db'
import {
  INBOX_KIND_RECORD,
  inboxEventPayloadOf,
  podBusyFactsOf,
  podResizeBusyOf,
  type PodBusy,
} from '@dltech/atlas-core'
import {
  failureText,
  jobsControlPlaneOf,
  podResizerOf,
  podSleeperOf,
  readPodResizeBusy,
  readPodsEnv,
  type PodResizeDeps,
} from '@dltech/atlas-pods'
import { triggerLog } from '../trigger-logger'

export type PodResizeGraph = { deps: PodResizeDeps }

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
  const sleeper = podSleeperOf({ env, db })
  return {
    deps: {
      session: (args) => plane.readSession(args),
      resize: (args) => resizer.resize(args),
      wake: async (args) => {
        const revoked = await plane.revoke({
          sessionId: args.sessionId,
          wantsHolder: true,
          epoch: args.epoch,
        })
        triggerLog.log(
          'ok' in revoked && !revoked.ok
            ? `${args.sessionId} was claimed again, so it is not rewoken`
            : `rewaking ${args.sessionId} at its new size`,
        )
      },
      park: (args) => sleeper.sleep(args),
      lease: async (args) => {
        const current = await plane.currentLease(args)
        return { live: current.live, epoch: current.lease.epoch }
      },
      placed: async (args) => plane.podSessionsPlaced(args),
      started: async (args) => {
        const posted = await plane.post({
          sessionId: args.sessionId,
          kind: INBOX_KIND_RECORD,
          payload: inboxEventPayloadOf({
            event: {
              type: 'pod-resize-started',
              vcpus: args.vcpus,
              memoryGb: args.memoryGb,
              generation: args.generation,
            },
          }),
        })
        triggerLog.log(`told ${args.sessionId} the pod is being resized`)
        return posted
      },
      consumed: async (args) => {
        const entry = await plane.readInboxEntry(args)
        return entry === undefined || entry.consumedSeq !== null
      },
      notice: async (args) => {
        await plane.post({
          sessionId: args.sessionId,
          kind: INBOX_KIND_RECORD,
          payload: inboxEventPayloadOf({ event: { type: 'pod-resized', ...args.notice } }),
        })
      },
      sleep: (args) => new Promise((resolve) => setTimeout(resolve, args.ms)),
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
        const recorded = await plane.recordPodWaiting(args)
        triggerLog.log(
          recorded
            ? `pod-resize for ${args.sessionId} waits for the pod to go idle`
            : `pod-resize for ${args.sessionId} no longer waits: generation ${args.generation} was replaced`,
        )
        return recorded
      },
      claimWait: async (args) => {
        const claimed = await plane.claimPodWait(args)
        triggerLog.log(
          claimed
            ? `pod-resize for ${args.sessionId} took the wait of ${args.since}: the pod is idle`
            : `pod-resize for ${args.sessionId} left the wait of ${args.since} to another run`,
        )
        return claimed
      },
      busy: (args) => busyOf({ plane, sessionId: args.sessionId }),
      now: () => new Date().toISOString(),
    },
  }
}

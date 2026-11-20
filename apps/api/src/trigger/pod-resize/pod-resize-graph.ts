import { ControlPlane } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import { db } from '@dltech/atlas-db'
import { podBusyFactsOf, podBusyOf } from '@dltech/atlas-core'
import { shellRosterOf } from '@dltech/atlas-plugin-shells/client'
import { servicesOfView } from '@dltech/atlas-plugin-services/client'
import { readAgentHostEnv } from '../../agent/config/env'
import { SecretCipher } from '../../agent/config/secret-cipher'
import { podResizerOf } from '../../agent/sandbox/sandbox-resizer'
import { failureText, type PodResizeDeps } from '../../api/platform/control/pod-resize-run'
import { podResizeTaskContract } from '../../api/platform/control/pod-resize.contract'
import { TriggerJobDispatcher } from '../../_lib/trigger/trigger-job-dispatcher'
import { workerEnvService } from '../github/github-sweep-graph'
import { triggerLog } from '../trigger-logger'

export type PodResizeGraph = { deps: PodResizeDeps }

const busyOf = async (args: { plane: ControlPlane; sessionId: string }) => {
  const session = await args.plane.readSession({ sessionId: args.sessionId })
  if (session === undefined)
    return podBusyOf(podBusyFactsOf({ state: undefined, shellsRunning: 0, servicesRunning: 0 }))
  const view = await args.plane.readSessionView({
    sessionId: args.sessionId,
    threadId: session.mainThreadId,
  })
  return podBusyOf(
    podBusyFactsOf({
      state: view.value.status.state,
      shellsRunning: shellRosterOf(view.value.pluginViews).running,
      servicesRunning: servicesOfView(view.value.pluginViews).filter(
        (row) => row.status === 'running',
      ).length,
    }),
  )
}

export function buildPodResizeGraph(): PodResizeGraph {
  const env = readAgentHostEnv()
  const plane = new ControlPlane({ store: new PostgresControlStore(db) })
  const resizer = podResizerOf({ env, db, cipher: new SecretCipher(env.secretsEncryptionKey) })
  const dispatcher = new TriggerJobDispatcher({
    secretKey: workerEnvService().get('TRIGGER_SECRET_KEY'),
  })
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
            `pod-resize applied ${args.vcpus} vCPU as generation ${args.generation} for ${args.sessionId}${
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
        const payload = { ...args.payload, waits: (args.payload.waits ?? 0) + 1 }
        await dispatcher.dispatch({
          task: podResizeTaskContract,
          payload,
          idempotencyKey: `${podResizeTaskContract.id}:${payload.sessionId}:${payload.generation}:${payload.waits}`,
          delay: `${args.delaySeconds}s`,
        })
        triggerLog.log(`pod-resize for ${payload.sessionId} waits ${args.delaySeconds}s for idle`)
      },
    },
  }
}

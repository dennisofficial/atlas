import { ControlPlane } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import { db } from '@dltech/atlas-db'
import { readAgentHostEnv } from '../../agent/config/env'
import { SecretCipher } from '../../agent/config/secret-cipher'
import { podResizerOf } from '../../agent/sandbox/sandbox-resizer'
import { failureText, type PodResizeDeps } from '../../api/platform/control/pod-resize-run'
import { triggerLog } from '../trigger-logger'

export type PodResizeGraph = { deps: PodResizeDeps }

export function buildPodResizeGraph(): PodResizeGraph {
  const env = readAgentHostEnv()
  const plane = new ControlPlane({ store: new PostgresControlStore(db) })
  const resizer = podResizerOf({ env, db, cipher: new SecretCipher(env.secretsEncryptionKey) })
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
    },
  }
}

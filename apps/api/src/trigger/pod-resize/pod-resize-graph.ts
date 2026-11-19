import { Logger } from '@nestjs/common'
import { ControlPlane } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import { db } from '@dltech/atlas-db'
import { podResizerOf, readAgentHostEnv, SecretCipher } from '../../agent'
import type { PodResizeDeps } from '../../api/platform/control/pod-resize-run'

export type PodResizeGraph = { deps: PodResizeDeps }

export function buildPodResizeGraph(): PodResizeGraph {
  const env = readAgentHostEnv()
  const plane = new ControlPlane({ store: new PostgresControlStore(db) })
  const resizer = podResizerOf({ env, db, cipher: new SecretCipher(env.secretsEncryptionKey) })
  const logger = new Logger('PodResize')
  return {
    deps: {
      session: (args) => plane.readSession(args),
      resize: (args) => resizer.resize(args),
      rewake: async (args) => {
        await plane.revoke({ sessionId: args.sessionId, wantsHolder: true })
        logger.log(`rewaking ${args.sessionId} at its new size`)
      },
      held: async (args) => (await plane.currentLease(args)).live,
      recordFailed: async (args) => {
        await plane.recordPodFailed(args)
        logger.warn(`pod-resize for ${args.sessionId} failed: ${args.error}`)
      },
    },
  }
}

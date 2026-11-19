import { Logger } from '@nestjs/common'
import { ControlPlane } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import { db } from '@dltech/atlas-db'
import { SecretCipherService } from '../../_lib/crypto/secret-cipher.service'
import { VercelPodSizer } from '../../agent/sandbox/vercel-pod-sizer'
import { buildScopedConfig } from '../../api/cloud/scoped-config/scoped-config.factory'
import { workerEnvService } from '../github/github-sweep-graph'
import type { PodResizeDeps } from '../../api/platform/control/pod-resize-run'

export type PodResizeGraph = { deps: PodResizeDeps }

export function buildPodResizeGraph(): PodResizeGraph {
  const env = workerEnvService()
  const cipher = new SecretCipherService(env)
  const scoped = buildScopedConfig({ cipher, env })
  const plane = new ControlPlane({ store: new PostgresControlStore(db) })
  const sizer = new VercelPodSizer()
  const logger = new Logger('PodResize')
  return {
    deps: {
      session: (args) => plane.readSession(args),
      credentials: (args) => scoped.vercelCredentials({ thread: { userId: args.userId } }),
      resize: (args) => sizer.resize(args),
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

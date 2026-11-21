import { db } from '@dltech/atlas-db'

import { readAgentHostEnv } from '../../agent/config/env'
import { SecretCipher } from '../../agent/config/secret-cipher'
import { podSleeperOf } from '../../agent/sandbox/sandbox-sleeper'
import { readPodBusy } from '../../api/platform/control/pod-busy'
import type { PodSleepDeps } from '../../api/platform/control/pod-sleep-run'
import { triggerControlPlane } from '../control-plane'

export type PodSleepGraph = { deps: PodSleepDeps }

export function buildPodSleepGraph(): PodSleepGraph {
  const env = readAgentHostEnv()
  const plane = triggerControlPlane()
  const sleeper = podSleeperOf({ env, db, cipher: new SecretCipher(env.secretsEncryptionKey) })
  return {
    deps: {
      session: (args) => plane.readSession(args),
      power: async (args) => {
        const { lease, live } = await plane.currentLease(args)
        return { epoch: lease.epoch, wantsHolder: lease.wantsHolder, live }
      },
      busy: async (args) => (await readPodBusy({ plane, session: args.session })).busy,
      release: async (args) => {
        await plane.revoke({
          sessionId: args.sessionId,
          wantsHolder: false,
          epoch: args.epoch,
        })
      },
      sleep: (args) => sleeper.sleep(args),
      wait: (args) => new Promise((resolve) => setTimeout(resolve, args.ms)),
    },
  }
}

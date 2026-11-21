import { db } from '@dltech/atlas-db'

import { readAgentHostEnv } from '../../agent/config/env'
import { SecretCipher } from '../../agent/config/secret-cipher'
import { podSleeperOf } from '../../agent/sandbox/sandbox-sleeper'
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
      sleep: (args) => sleeper.sleep(args),
    },
  }
}

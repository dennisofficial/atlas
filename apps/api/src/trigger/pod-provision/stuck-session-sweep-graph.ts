import { Logger } from '@nestjs/common'
import type { EnvService } from '../../_core/config/env/env.service'
import { SecretCipherService } from '../../_lib/crypto/secret-cipher.service'
import { TriggerJobDispatcher } from '../../_lib/trigger/trigger-job-dispatcher'
import { PodLaunchService } from '../../api/cloud/sandbox-provisioning/pod-launch.service'
import type { StuckRecoveryDeps } from '../../api/cloud/sandbox-provisioning/stuck-session-recovery'
import { ScopedConfigService } from '../../api/cloud/scoped-config/scoped-config.service'
import { workerEnvService } from '../github/github-sweep-graph'
import { buildWorkerThreadSignals, type WorkerThreadSignals } from '../thread-signals-graph'

export type StuckSessionSweepGraph = {
  deps: StuckRecoveryDeps
  dispose: WorkerThreadSignals['dispose']
}

export function buildStuckSessionSweepGraph(args: { env: EnvService }): StuckSessionSweepGraph {
  const { env } = args
  const { signals, dispose } = buildWorkerThreadSignals({ env })
  const cipher = new SecretCipherService(env)
  const logger = new Logger('StuckSessionSweep')
  const dispatcher = new TriggerJobDispatcher({ secretKey: env.get('TRIGGER_SECRET_KEY') })
  return {
    deps: {
      pod: new PodLaunchService(new ScopedConfigService(cipher), cipher, dispatcher, signals),
      cipher,
      fetch,
      log: (line) => logger.warn(line),
    },
    dispose,
  }
}

export const workerStuckSessionSweepGraph = (): StuckSessionSweepGraph =>
  buildStuckSessionSweepGraph({ env: workerEnvService() })
